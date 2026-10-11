import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { LibraryPage } from "./pages/LibraryPage";
import { ReaderPage } from "./pages/ReaderPage";
import { LensesPage } from "./pages/LensesPage";
import { NotificationProvider } from "./NotificationContext";
import { ToastProvider } from "./ToastContext";
import { MessagesPage } from "./pages/MessagesPage";
import { AdminPage } from "./pages/AdminPage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { InvitationPage } from "./pages/InvitationPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/invitation" element={<InvitationPage />} />
          <Route path="/" element={<RequireAuth><NotificationProvider><ToastProvider><LibraryPage /></ToastProvider></NotificationProvider></RequireAuth>} />
          <Route path="/documents/:id" element={<RequireAuth><NotificationProvider><ToastProvider><ReaderPage /></ToastProvider></NotificationProvider></RequireAuth>} />
          <Route path="/lenses" element={<RequireAuth><NotificationProvider><ToastProvider><LensesPage /></ToastProvider></NotificationProvider></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth><NotificationProvider><ToastProvider><AdminPage /></ToastProvider></NotificationProvider></RequireAuth>} />
          <Route path="/messages" element={<RequireAuth><NotificationProvider><ToastProvider><MessagesPage /></ToastProvider></NotificationProvider></RequireAuth>} />
          <Route path="/collections" element={<RequireAuth><NotificationProvider><ToastProvider><CollectionsPage /></ToastProvider></NotificationProvider></RequireAuth>} />
          <Route path="/collections/:id" element={<RequireAuth><NotificationProvider><ToastProvider><CollectionsPage /></ToastProvider></NotificationProvider></RequireAuth>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
