import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedOrigins, isAllowedOrigin, primaryOrigin } from "../utils/origins.js";

const env = {
  WEB_ORIGIN: "https://femsa-audit.vercel.app, https://femsa-audit-staging.vercel.app/ ,http://127.0.0.1:5173",
  WEB_ORIGIN_PATTERN: "^https://femsa-audit-[a-z0-9]+-emilianocbes-projects\\.vercel\\.app$",
};

test("WEB_ORIGIN acepta varios orígenes y el primero es el principal", () => {
  assert.deepEqual(allowedOrigins(env), [
    "https://femsa-audit.vercel.app",
    "https://femsa-audit-staging.vercel.app",
    "http://127.0.0.1:5173",
  ]);
  assert.equal(primaryOrigin(env), "https://femsa-audit.vercel.app");
  assert.deepEqual(allowedOrigins({}), ["http://127.0.0.1:5173"]);
});

test("permite producción, staging y los previews de PR; rechaza dominios parecidos", () => {
  for (const origin of [
    "https://femsa-audit.vercel.app",
    "https://femsa-audit-staging.vercel.app",
    "https://femsa-audit-17v62xkm5-emilianocbes-projects.vercel.app",
  ]) {
    assert.equal(isAllowedOrigin(origin, env), true, origin);
  }
  for (const origin of [
    "https://femsa-audit.vercel.app.evil.com",
    "https://evil-femsa-audit-abc-emilianocbes-projects.vercel.app",
    "https://femsa-audit-abc-emilianocbes-projects.vercel.app.evil.com",
    "http://femsa-audit.vercel.app",
    "",
    undefined,
  ]) {
    assert.equal(isAllowedOrigin(origin, env), false, String(origin));
  }
  assert.equal(
    isAllowedOrigin("https://femsa-audit-abc-emilianocbes-projects.vercel.app", { WEB_ORIGIN: env.WEB_ORIGIN }),
    false,
  );
});
