import assert from "node:assert/strict";
import { test } from "node:test";
import { requirePermission } from "../middlewares/permissions.js";

const run = (middleware, user) => {
  let called = false;
  middleware({ user }, {}, () => {
    called = true;
  });
  return called;
};

test("US14.2 requirePermission deja pasar con todos los permisos", () => {
  const user = { permissions: [{ name: "designer.view" }, { name: "designer.edit" }] };
  assert.equal(run(requirePermission("designer.view", "designer.edit"), user), true);
});

test("US14.2 requirePermission responde 403 si falta un permiso", () => {
  const user = { permissions: [{ name: "designer.view" }] };
  assert.throws(() => run(requirePermission("designer.edit"), user), { status: 403 });
  assert.throws(() => run(requirePermission("designer.view"), {}), { status: 403 });
});
