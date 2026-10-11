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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RequireAuth>
          <NotificationProvider>
          <ToastProvider>
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/documents/:id" element={<ReaderPage />} />
            <Route path="/lenses" element={<LensesPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/collections" element={<CollectionsPage />} />
            <Route path="/collections/:id" element={<CollectionsPage />} />
          </Routes>
          </ToastProvider>
          </NotificationProvider>
        </RequireAuth>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
