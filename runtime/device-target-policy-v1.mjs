export function resolveDeviceTargetPolicy({
  operation,
  requestedDeviceId,
  candidates,
}) {
  const op = String(operation || "");
  const devices = Array.isArray(candidates) ? candidates : [];
  const requested = typeof requestedDeviceId === "string" && requestedDeviceId.trim() !== ""
    ? requestedDeviceId.trim()
    : null;

  if (devices.length === 0) {
    throw new Error(`device_target_unavailable:${op}`);
  }

  const exact = requested
    ? devices.find((device) => String(device?.device_id || "") === requested)
    : null;

  if (requested && !exact) {
    throw new Error(`requested_device_unavailable:${requested}:${op}`);
  }

  if (!requested) {
    if (devices.length > 1) {
      throw new Error(`device_target_required_ambiguous:${op}:${devices.map((d) => String(d?.device_id || "")).filter(Boolean).join(",")}`);
    }
    return {
      selected: devices[0],
      requested_device_id: null,
      fallback: false,
      reason: "single_online_capable_device",
    };
  }

  return {
    selected: exact,
    requested_device_id: requested,
    fallback: false,
    reason: "requested_device_online_and_capable",
  };
}
