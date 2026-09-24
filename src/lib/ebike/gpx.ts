import type { RideRecord } from "./rideStore";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 주행 기록을 GPX 파일(Strava·Garmin 등에서 가져오기 가능)로 변환 */
export function rideToGpx(ride: RideRecord): string {
  const name = `E-Bike ${new Date(ride.startedAt).toLocaleString("ko-KR")}`;
  const pts = ride.points
    .map(
      ([lat, lng, sec]) =>
        `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><time>${new Date(
          ride.startedAt + sec * 1000,
        ).toISOString()}</time></trkpt>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ara-ebike" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name><time>${new Date(ride.startedAt).toISOString()}</time></metadata>
  <trk>
    <name>${esc(name)}</name>
    <type>cycling</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** 아이폰 공유 시트로 파일 공유, 안 되면 다운로드 */
export async function shareFile(filename: string, content: string, type: string) {
  const file = new File([content], filename, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
