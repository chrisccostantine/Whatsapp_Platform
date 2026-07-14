import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, MessageCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "../lib/api";

type EmbeddedSignupConfig = { enabled: boolean; appId?: string; configId?: string; graphVersion?: string };
type EmbeddedSignupSession = { code?: string; whatsAppBusinessAccountId?: string; phoneNumberId?: string };
type ConnectForm = { whatsAppBusinessAccountId: string; phoneNumberId: string; accessToken: string; verifyToken: string; metaAppId: string };
type FacebookLoginResponse = { authResponse?: { code?: string } };
type FacebookSdk = {
  init: (options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
  login: (callback: (response: FacebookLoginResponse) => void, options: Record<string, unknown>) => void;
};

declare global {
  interface Window { FB?: FacebookSdk; fbAsyncInit?: () => void }
}

const apiMessage = (error: unknown) => (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? (error instanceof Error ? error.message : "The connection could not be completed");

function loadFacebookSdk(appId: string, version: string) {
  return new Promise<FacebookSdk>((resolve, reject) => {
    const initialize = () => {
      if (!window.FB) { reject(new Error("Meta's connection window could not be loaded")); return; }
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB);
    };
    if (window.FB) { initialize(); return; }
    window.fbAsyncInit = initialize;
    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.onerror = () => reject(new Error("Meta's connection window could not be loaded"));
      document.body.appendChild(script);
    }
    window.setTimeout(() => { if (!window.FB) reject(new Error("Meta's connection window took too long to load")); }, 20_000);
  });
}

export function WhatsAppConnectCard({ onConnected }: { onConnected: () => void }) {
  const [message, setMessage] = useState("");
  const config = useQuery({ queryKey: ["whatsapp-embedded-signup-config"], queryFn: async () => (await api.get("/whatsapp/embedded-signup/config")).data.data as EmbeddedSignupConfig });
  const embedded = useMutation({ mutationFn: (session: Required<EmbeddedSignupSession>) => api.post("/whatsapp/account/embedded-signup", session), onSuccess: onConnected });
  const manual = useMutation({ mutationFn: (values: ConnectForm) => api.post("/whatsapp/account/connect", { ...values, metaAppId: values.metaAppId || undefined }), onSuccess: onConnected });
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<ConnectForm>();

  const launchEmbeddedSignup = async () => {
    const settings = config.data;
    if (!settings?.enabled || !settings.appId || !settings.configId || !settings.graphVersion) { setMessage("One-click connection is not configured yet. Ask the Scalora administrator to finish the Meta setup."); return; }
    setMessage("");
    try {
      const facebook = await loadFacebookSdk(settings.appId, settings.graphVersion);
      const session: EmbeddedSignupSession = {};
      let submitted = false;
      let sessionHandler: (event: MessageEvent) => void = () => undefined;
      const cleanup = () => window.removeEventListener("message", sessionHandler);
      const submitWhenReady = () => {
        if (submitted || !session.code || !session.whatsAppBusinessAccountId || !session.phoneNumberId) return;
        submitted = true;
        cleanup();
        embedded.mutate(session as Required<EmbeddedSignupSession>);
      };
      sessionHandler = (event: MessageEvent) => {
        if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
        try {
          const payload = typeof event.data === "string" ? JSON.parse(event.data) as { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string } } : event.data as { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string } };
          if (payload?.type !== "WA_EMBEDDED_SIGNUP") return;
          if (payload.event === "FINISH") {
            session.whatsAppBusinessAccountId = payload.data?.waba_id;
            session.phoneNumberId = payload.data?.phone_number_id;
            submitWhenReady();
          } else if (payload.event === "CANCEL") { cleanup(); setMessage("WhatsApp connection was cancelled."); }
          else if (payload.event === "ERROR") { cleanup(); setMessage("Meta could not complete the WhatsApp setup. Please try again."); }
        } catch { /* Ignore unrelated browser messages. */ }
      };
      window.addEventListener("message", sessionHandler);
      facebook.login((response) => {
        if (response.authResponse?.code) { session.code = response.authResponse.code; submitWhenReady(); }
        else { cleanup(); setMessage("Meta login was cancelled or did not return authorization."); }
      }, { config_id: settings.configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: "3" } });
    } catch (error) { setMessage(apiMessage(error)); }
  };

  const error = embedded.error ?? manual.error;
  return <section className="card mt-7 max-w-2xl overflow-hidden">
    <div className="bg-gradient-to-br from-brand-50 to-white p-7 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm"><MessageCircle size={28}/></span>
      <h2 className="mt-4 text-xl font-bold">Connect WhatsApp to Scalora</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">Sign in with Meta, choose your business and phone number, and Scalora will securely finish the setup for you.</p>
      <button type="button" onClick={() => void launchEmbeddedSignup()} disabled={config.isLoading || embedded.isPending} className="btn-primary mx-auto mt-6 gap-2 px-7">
        <ExternalLink size={17}/>{embedded.isPending ? "Finishing connection…" : "Connect with WhatsApp"}
      </button>
      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500"><ShieldCheck size={15} className="text-brand-600"/>Your Meta password and access token are never shown to Scalora users.</div>
      {(message || error) && <p className="mt-4 text-sm font-medium text-red-600">{message || apiMessage(error)}</p>}
    </div>
    <details className="border-t px-6 py-4 text-sm">
      <summary className="cursor-pointer font-semibold text-slate-500">Advanced manual connection</summary>
      <p className="mt-3 text-slate-500">For development or support use only. Enter credentials generated in Meta Business Manager.</p>
      <form onSubmit={handleSubmit((values) => manual.mutateAsync(values))} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="font-medium">Business Account ID<input required className="field mt-1.5" {...register("whatsAppBusinessAccountId")}/></label>
        <label className="font-medium">Phone Number ID<input required className="field mt-1.5" {...register("phoneNumberId")}/></label>
        <label className="sm:col-span-2 font-medium">Access token<input required type="password" autoComplete="off" className="field mt-1.5" {...register("accessToken")}/></label>
        <label className="sm:col-span-2 font-medium">Webhook verification token<input required type="password" autoComplete="off" className="field mt-1.5" {...register("verifyToken")}/></label>
        <label className="sm:col-span-2 font-medium">Meta App ID (optional)<input className="field mt-1.5" {...register("metaAppId")}/></label>
        <button disabled={isSubmitting || manual.isPending} className="btn-secondary sm:col-span-2">Connect manually</button>
      </form>
    </details>
  </section>;
}
