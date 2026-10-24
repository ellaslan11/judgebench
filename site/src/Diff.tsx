export default function Diff({ text, maxLines = 400 }: { text: string; maxLines?: number }) {
  const lines = text.split("\n");
  const shown = lines.slice(0, maxLines);
  return (
    <pre className="diff">
      {shown.map((ln, i) => {
        const cls = ln.startsWith("diff --git")
          ? "file"
          : ln.startsWith("@@")
            ? "hunk"
            : ln.startsWith("+++") || ln.startsWith("---") || ln.startsWith("index ")
              ? "meta"
              : ln.startsWith("+")
                ? "add"
                : ln.startsWith("-")
                  ? "del"
                  : "";
        return (
          <div key={i} className={`dl ${cls}`}>
            {ln || " "}
          </div>
        );
      })}
      {lines.length > maxLines && <div className="dl meta">… {lines.length - maxLines} more lines</div>}
    </pre>
  );
}
