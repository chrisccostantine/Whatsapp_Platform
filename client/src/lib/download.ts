import { api } from "./api";
export async function downloadPdf(path:string,fileName:string){const response=await api.get(path,{responseType:"blob"});const url=URL.createObjectURL(response.data as Blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=fileName;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
