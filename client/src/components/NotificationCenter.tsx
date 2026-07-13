import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";

type Notification = { id: string; type: string; title: string; body: string; readAt?: string; createdAt: string };
type NotificationResponse = { items: Notification[]; unreadCount: number };

export function NotificationCenter() {
  const [open, setOpen] = useState(false); const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: async () => (await api.get("/notifications?limit=20")).data.data as NotificationResponse, refetchInterval: 30_000 });
  const readAll = useMutation({ mutationFn: () => api.patch("/notifications/read-all"), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }) });
  const readOne = useMutation({ mutationFn: (id: string) => api.patch(`/notifications/${id}/read`), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }) });
  return <div className="relative"><button aria-label="Notifications" onClick={() => setOpen((value) => !value)} className="relative rounded-xl border bg-white p-2 text-slate-600 hover:bg-slate-50"><Bell size={19}/>{Boolean(data?.unreadCount) && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">{Math.min(data?.unreadCount ?? 0, 99)}</span>}</button>{open && <div className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border bg-white shadow-xl"><div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="font-bold">Notifications</h2><p className="text-xs text-slate-500">{data?.unreadCount ?? 0} unread</p></div><button disabled={!data?.unreadCount || readAll.isPending} onClick={() => readAll.mutate()} className="flex items-center gap-1 text-xs font-semibold text-brand-700 disabled:opacity-40"><CheckCheck size={15}/>Mark all read</button></div><div className="max-h-[28rem] overflow-y-auto">{data?.items.length ? data.items.map((item) => <button key={item.id} onClick={() => { if (!item.readAt) readOne.mutate(item.id); }} className={`block w-full border-b px-4 py-3 text-left last:border-0 ${item.readAt ? "bg-white" : "bg-brand-50/60"}`}><div className="flex gap-3"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-slate-200" : "bg-brand-500"}`}/><div><p className="text-sm font-semibold">{item.title}</p><p className="mt-0.5 text-xs text-slate-600">{item.body}</p><p className="mt-1 text-[11px] text-slate-400">{new Date(item.createdAt).toLocaleString()}</p></div></div></button>) : <div className="p-10 text-center text-sm text-slate-500">You’re all caught up.</div>}</div></div>}</div>;
}
