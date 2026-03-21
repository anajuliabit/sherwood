"use client";

interface ErrorDisplayProps {
  title?: string;
  minHeight?: string;
  reset: () => void;
}

export default function ErrorDisplay({
  title = "Something went wrong",
  minHeight = "100vh",
  reset,
}: ErrorDisplayProps) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      minHeight,
      fontFamily: "var(--font-plus-jakarta), sans-serif",
      gap: "1rem",
    }}>
      <h2 style={{ color: "white", fontSize: "1.5rem", fontWeight: 600 }}>
        {title}
      </h2>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "14px" }}>
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        style={{
          marginTop: "1rem",
          padding: "0.5rem 1.5rem",
          background: "var(--color-accent)",
          color: "black",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: "14px",
        }}
      >
        Try Again
      </button>
    </div>
  );
}
