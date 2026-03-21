export default function LoadingSkeleton() {
  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "60vh",
      fontFamily: "var(--font-plus-jakarta), sans-serif",
      color: "rgba(255,255,255,0.3)",
      fontSize: "14px",
    }}>
      Loading...
    </div>
  );
}
