import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const configPath = fileURLToPath(new URL("./src/flight-config.json", import.meta.url));
const configKeys = [
  "thrust",
  "reverseThrust",
  "turnSpeed",
  "maxSpeed",
  "boostMultiplier",
  "boostSpeedMultiplier",
  "boostEnergyPerSecond",
  "maxEnergy",
  "energyRechargePerSecond",
  "shipRadius",
  "wallRestitution",
  "bulletSpeed",
  "bulletLifetime",
  "bulletEnergyCost",
  "bulletCooldown",
  "bulletDamage",
];

function flightConfigPlugin(): Plugin {
  return {
    name: "flight-config-file",
    configureServer(server) {
      server.middlewares.use("/__flight-config", (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }

        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          try {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!isValidConfig(parsed)) {
              response.statusCode = 400;
              response.end("Invalid flight configuration");
              return;
            }
            fs.writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
            // The file watcher intentionally ignores this developer-only file so
            // changing a slider does not trigger a full HMR reload. Invalidate
            // Vite's cached JSON module explicitly so the next page refresh
            // reads the values that were just persisted.
            server.moduleGraph.onFileChange(configPath);
            response.statusCode = 204;
            response.end();
          } catch {
            response.statusCode = 400;
            response.end("Invalid JSON");
          }
        });
      });
    },
  };
}

function isValidConfig(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === configKeys.length &&
    configKeys.every((key) => typeof record[key] === "number" && Number.isFinite(record[key]));
}

export default defineConfig({
  base: "./",
  plugins: [flightConfigPlugin()],
  server: {
    watch: {
      ignored: [configPath],
    },
  },
});
