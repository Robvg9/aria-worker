export function shouldRejectMcpGet(request) {
  const protocol = (request.headers.get("mcp-protocol-version") ?? "").trim();
  const accept = request.headers.get("accept") ?? "";
  const acceptsEventStream = accept.split(",").some((entry) => entry.trim().split(";")[0].toLowerCase() === "text/event-stream");
  return protocol === "2026-07-28" || acceptsEventStream;
}
