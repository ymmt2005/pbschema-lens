/** Syntax coloring for embedded .proto text. The input is untrusted; markup is escaped first. */
export function highlightProto(source: string): string {
  const escaped = source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return escaped.replace(
    /\b(syntax|edition|package|import|option|message|enum|service|rpc|returns|stream|repeated|optional|required|reserved|to|extend|oneof|map|true|false)\b|(\/\/.*$)|("(?:\\.|[^"])*")|(\b\d+\b)/gm,
    (match, keyword: string | undefined, comment: string | undefined, string: string | undefined, number: string | undefined) => {
      if (keyword) return `<span class="text-[color:var(--accent)]">${match}</span>`;
      if (comment) return `<span class="text-[color:var(--fg-muted)]">${match}</span>`;
      if (string) return `<span class="text-[color:var(--accent-2)]">${match}</span>`;
      if (number) return `<span class="num">${match}</span>`;
      return match;
    },
  );
}
