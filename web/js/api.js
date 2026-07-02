async function fetchJSON(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function getFiles() {
  return fetchJSON("/api/files");
}

export function getSession(file) {
  return fetchJSON(`/api/session?file=${encodeURIComponent(file)}`);
}

export function getChannel(file, channel, startTs, endTs) {
  return fetchJSON(
    `/api/channel?file=${encodeURIComponent(file)}&channel=${encodeURIComponent(channel)}&start=${startTs}&end=${endTs}`
  );
}
