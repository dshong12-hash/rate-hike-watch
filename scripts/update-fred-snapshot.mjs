import { mkdir, readFile, writeFile } from "node:fs/promises";

const series = ["DFEDTARU", "DGS2", "DGS10", "T10YIE", "CPIAUCSL", "PCEPILFE", "UNRATE"];
const outputPath = new URL("../data/fred-snapshot.json", import.meta.url);

const previous = await readPreviousSnapshot();
const snapshot = {
  updatedAt: new Date().toISOString(),
  errors: [],
  series: previous.series || {}
};

await Promise.all(series.map(async (id) => {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { signal: controller.signal })
      .finally(() => clearTimeout(timer));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rows = parseFredCsv(await response.text()).slice(-80);
    if (!rows.length) {
      throw new Error("No rows returned");
    }
    snapshot.series[id] = rows;
  } catch (error) {
    snapshot.errors.push({ id, message: error.message });
  }
}));

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);

function parseFredCsv(csv) {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, value] = line.split(",");
      return { date, value };
    })
    .filter((row) => row.date && row.value && row.value !== ".");
}

async function readPreviousSnapshot() {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    return { series: {} };
  }
}
