import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import "./index.css";
const client=new QueryClient({defaultOptions:{queries:{staleTime:30_000,retry:1}}});
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={client}><BrowserRouter><AuthProvider><App/></AuthProvider></BrowserRouter></QueryClientProvider></React.StrictMode>);
