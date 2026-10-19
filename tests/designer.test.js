import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { versionsRepository } from "../repositories/versions.repository.js";

let server;
let base;

// Última versión guardada de "layout dummy": el lienzo debe cargarse desde aquí y no desde la plantilla por defecto.
const savedElements = [
  { id: "titulo", type: "short-text", x: 24, y: 24, width: 280, height: 48, config: { label: "Titulo del hallazgo" } },
  { id: "monto", type: "number", x: 24, y: 96, width: 200, height: 48, config: { label: "Monto" } },
  { id: "fecha", type: "date", x: 24, y: 168, width: 200, height: 48, config: { label: "Fecha" } },
];

before(async () => {
  mock.method(versionsRepository, "list", async (appId) => (appId === "layout dummy" ? [{ id: 9, number: 6 }] : []));
  mock.method(versionsRepository, "findById", async (appId, id) =>
    appId === "layout dummy" && id === 9 ? { id, config: { elements: savedElements } } : null,
  );
  Object.assign(process.env, {
    DB_SERVER: "test",
    DB_NAME: "test",
    DB_USER: "test",
    DB_PASSWORD: "test",
    WEB_ORIGIN: "http://127.0.0.1:5173",
  });

  const { default: app } = await import("../app.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  base = `http://127.0.0.1:${server.address().port}/api/designer`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  mock.restoreAll();
});

const jsonHeaders = { "Content-Type": "application/json" };

test("US03 lista layouts disponibles para el Designer", async () => {
  const response = await fetch(`${base}/layouts`);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.layouts));
  assert.equal(body.layouts[0].id, "layout dummy");
});

test("US11 al arrancar, el lienzo se carga desde la última versión guardada", async () => {
  const response = await fetch(`${base}/layouts/${encodeURIComponent("layout dummy")}`);

  assert.equal(response.status, 200);
  const { layout } = await response.json();
  assert.deepEqual(
    layout.elements.map(element => element.id),
    savedElements.map(element => element.id),
  );
  // Solo se carga una vez por ejecución: no vuelve a consultar las versiones.
  assert.equal(versionsRepository.list.mock.callCount(), 1);
});

test("US03 crea layout y guarda elementos arrastrados al canvas", async () => {
  const createResponse = await fetch(`${base}/layouts`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      name: "Módulo prueba Drag Drop",
      elements: [
        {
          type: "short-text",
          x: 10,
          y: 20,
          width: 240,
          height: 48,
          config: { label: "Nombre", required: true },
        },
      ],
    }),
  });

  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  const layoutId = created.layout.id;
  assert.equal(created.layout.elements.length, 1);

  const updateResponse = await fetch(`${base}/layouts/${layoutId}/canvas`, {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify({
      elements: [
        {
          id: created.layout.elements[0].id,
          type: "short-text",
          x: 120,
          y: 180,
          width: 260,
          height: 50,
          config: { label: "Nombre actualizado", required: true },
        },
        {
          type: "date",
          x: 120,
          y: 250,
          width: 180,
          height: 48,
          config: { label: "Fecha compromiso" },
        },
      ],
    }),
  });

  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated.layout.elements.length, 2);
  assert.equal(updated.layout.elements[0].x, 120);
  assert.equal(updated.layout.elements[1].type, "date");
});

test("US03 valida payloads inválidos", async () => {
  const response = await fetch(`${base}/layouts`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      name: "Layout inválido",
      elements: [{ type: "short-text", x: "10", y: 20, width: 100, height: 40 }],
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.message, /coordenadas/);
});
