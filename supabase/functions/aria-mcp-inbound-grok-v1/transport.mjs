const EVENT_STREAM = "text/event-stream";
const PROTOCOL_WITHOUT_GET_STREAM = "2026-07-28";

function acceptsEventStream(acceptHeader) {
  return String(acceptHeader ?? "").split(",").some((entry) => {
    const [mediaType, ...parameters] = entry.trim().split(";");
    if (String(mediaType ?? "").trim().toLowerCase() !== EVENT_STREAM) return false;
    const quality = parameters.map((p) => p.trim()).find((p) => /^q\s*=/i.test(p));
    return quality === undefined || Number(quality.slice(quality.indexOf("=") + 1).trim()) > 0;
  });
}

/** Reject GET requests when this server does not expose a server-initiated SSE stream. */
export function shouldRejectMcpGet(request) {
  const protocol = (request.headers.get("mcp-protocol-version") ?? "").trim();
  return protocol === PROTOCOL_WITHOUT_GET_STREAM ||
    acceptsEventStream(request.headers.get("accept"));
}
