// Pure helpers shared by the measurement harness and its regression tests.
export const payloadBytes = (data) =>
  typeof data === "string"
    ? new TextEncoder().encode(data).byteLength
    : data.byteLength;

export function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
    : null;
}

export function parseArgs(args) {
  const opts = {
    guests: 2,
    mode: "deathmatch",
    map: undefined,
    lag: 40,
    seconds: 20,
    url: undefined,
  };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2),
      value = args[i + 1];
    if (!args[i].startsWith("--") || !Object.hasOwn(opts, key))
      throw new Error(`Unknown option: ${args[i]}`);
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for --${key}`);
    opts[key] = ["guests", "lag", "seconds"].includes(key)
      ? Number(value)
      : value;
  }
  if (!Number.isInteger(opts.guests) || opts.guests < 1 || opts.guests > 9)
    throw new Error(
      "--guests must be an integer from 1 to 9 (ten players maximum)",
    );
  if (!Number.isFinite(opts.lag) || opts.lag < 0)
    throw new Error(
      "--lag must be a finite, nonnegative number of milliseconds",
    );
  if (!Number.isFinite(opts.seconds) || opts.seconds <= 0)
    throw new Error("--seconds must be a finite, positive duration");
  if (!["deathmatch", "race"].includes(opts.mode))
    throw new Error("--mode must be deathmatch or race");
  opts.map ||= opts.mode === "race" ? "route67" : "ghost-town";
  if (opts.url && !["http:", "https:"].includes(new URL(opts.url).protocol))
    throw new Error("--url must use http or https");
  return opts;
}

export function matchUrl(base, lag) {
  const url = new URL(base);
  url.searchParams.set("net", "local");
  url.searchParams.set("lag", String(lag));
  return url.href;
}

export function measureDrift(history, samples) {
  const own = [],
    other = [];
  let i = 0;
  for (const sample of samples) {
    while (i + 1 < history.length && history[i + 1].at < sample.at) i++;
    const a = history[i],
      b = history[i + 1];
    if (!a || !b || sample.at < a.at || sample.at > b.at) continue;
    const k = b.at === a.at ? 0 : (sample.at - a.at) / (b.at - a.at);
    for (const car of sample.cars) {
      const ca = a.cars.find((c) => c.pid === car.pid),
        cb = b.cars.find((c) => c.pid === car.pid);
      if (
        !ca ||
        !cb ||
        !car.alive ||
        ca.alive !== car.alive ||
        cb.alive !== car.alive
      )
        continue;
      const x = ca.x + (cb.x - ca.x) * k,
        z = ca.z + (cb.z - ca.z) * k;
      (car.pid === sample.me ? own : other).push(
        Math.hypot(car.x - x, car.z - z),
      );
    }
  }
  return { own, other };
}
