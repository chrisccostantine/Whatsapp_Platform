import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/config/env.js",()=>({env:{WHATSAPP_API_VERSION:"v23.0"}}));
const {WhatsAppCloudProvider}=await import("../src/modules/whatsapp/cloud.provider.js");
describe("official WhatsApp Cloud provider",()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it("sends text through the versioned Meta Graph endpoint",async()=>{const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({messages:[{id:"wamid.123"}]}),{status:200,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetchMock);const provider=new WhatsAppCloudProvider("phone-123","secret-token");const result=await provider.send({businessId:"business-a",conversationId:"conversation-a",messageId:"message-a",recipientPhone:"+9613123456",type:"TEXT",body:"Hello"});expect(result.providerMessageId).toBe("wamid.123");expect(fetchMock).toHaveBeenCalledWith("https://graph.facebook.com/v23.0/phone-123/messages",expect.objectContaining({method:"POST"}));const request=fetchMock.mock.calls[0]![1] as RequestInit;expect(new Headers(request.headers).get("authorization")).toBe("Bearer secret-token");expect(JSON.parse(request.body as string)).toMatchObject({messaging_product:"whatsapp",to:"9613123456",type:"text"});});
});
