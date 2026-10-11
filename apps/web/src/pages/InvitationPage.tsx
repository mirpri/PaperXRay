import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { loginUrl, validateInvitationCode } from "../api";
import { Logo } from "../components/Logo";

export function InvitationPage() {
  const [searchParams] = useSearchParams();
  const invitationCode = searchParams.get("code");
  const [validationState, setValidationState] = useState<{
    loading: boolean;
    valid: boolean;
    error?: string;
    role?: string;
    email?: string | null;
  }>({ loading: true, valid: false });

  useEffect(() => {
    if (!invitationCode) {
      setValidationState({ loading: false, valid: false, error: "No invitation code provided" });
      return;
    }

    validateInvitationCode(invitationCode)
      .then((result) => {
        setValidationState({
          loading: false,
          valid: result.valid,
          error: result.error,
          role: result.role,
          email: result.email,
        });
      })
      .catch((err) => {
        setValidationState({
          loading: false,
          valid: false,
          error: err.message || "Failed to validate invitation",
        });
      });
  }, [invitationCode]);

  const handleLogin = () => {
    if (invitationCode) {
      window.location.href = `${loginUrl()}?invitation=${encodeURIComponent(invitationCode)}`;
    } else {
      window.location.href = loginUrl();
    }
  };

  return (
    <div
      style={{
        minHeight: "100svh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 340,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          textAlign: "center",
        }}
      >
        <Logo size={40} />
        <div>
          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>
            Paper X-Ray
          </h1>
          <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
            You've been invited to join the organization.
          </p>
        </div>
        
        {validationState.loading ? (
          <div style={{
            width: "100%",
            padding: "12px",
            fontSize: 13,
            color: "var(--text-muted)",
          }}>
            Validating invitation...
          </div>
        ) : validationState.valid ? (
          <>
            <button
              onClick={handleLogin}
              style={{
                width: "100%",
                height: 38,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 500,
                color: "#FFFFFF",
                background: "var(--text)",
                borderRadius: 3,
                border: "none",
                cursor: "pointer",
              }}
            >
              Sign in to continue
            </button>{validationState.email && (
              <p style={{ fontSize: 12, color: "var(--text-soft)", margin: 0 }}>
                Invitation for: {validationState.email}. Please sign in with this email to accept the invitation.
              </p>
            )}
          </>
        ) : (
          <div style={{
            width: "100%",
            padding: "12px",
            fontSize: 13,
            background: "#B42318",
            color: "#FEF3F2",
            borderRadius: 3,
          }}>
            {validationState.error || "Invalid invitation code"}
          </div>
        )}
        
        <p style={{ fontSize: 12, color: "var(--text-soft)", margin: 0 }}>
          Already have an account?{" "}
          <a href={loginUrl()} style={{ color: "var(--human)", textDecoration: "none" }}>
            Sign in here
          </a>
        </p>
      </div>
    </div>
  );
}
