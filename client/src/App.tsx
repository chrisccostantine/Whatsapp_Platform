import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { useAuth } from "./lib/auth";
import { AuthPage } from "./pages/AuthPage";
import { CustomersPage } from "./pages/CustomersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { FollowUpsPage, PipelinePage, ReportsPage, SettingsPage } from "./pages/CollectionPage";
function Protected({ children }: { children: React.ReactNode }) { const { session, loading }=useAuth(); if(loading)return <div className="grid min-h-screen place-items-center text-brand-700">Loading Scalora…</div>; if(!session)return <Navigate to="/login" replace/>; return children; }
export default function App(){return <Routes><Route path="/login" element={<AuthPage/>}/><Route path="/register" element={<AuthPage register/>}/><Route path="/onboarding" element={<Protected><OnboardingPage/></Protected>}/><Route element={<Protected><AppShell/></Protected>}><Route index element={<DashboardPage/>}/><Route path="customers" element={<CustomersPage/>}/><Route path="pipeline" element={<PipelinePage/>}/><Route path="follow-ups" element={<FollowUpsPage/>}/><Route path="reports" element={<ReportsPage/>}/><Route path="settings" element={<SettingsPage/>}/></Route><Route path="*" element={<Navigate to="/" replace/>}/></Routes>}

