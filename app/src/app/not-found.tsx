import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "var(--font-plus-jakarta), sans-serif",
        color: "rgba(255,255,255,0.7)",
        gap: "1.5rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontSize: "4rem",
          fontWeight: 700,
          color: "rgba(255,255,255,0.15)",
          margin: 0,
          lineHeight: 1,
        }}
      >
        404
      </h1>
      <p
        style={{
          fontSize: "14px",
          color: "rgba(255,255,255,0.4)",
          margin: 0,
        }}
      >
        Page not found.
      </p>
      <Link
        href="/"
        style={{
          color: "var(--color-accent)",
          fontSize: "12px",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          textDecoration: "none",
        }}
      >
        Back to Home
      </Link>
    </div>
  );
}
