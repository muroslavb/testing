"use strict";
/**
 * Лабораторна робота №6 — Automated REST API Testing
 * SUT B, варіант 01 (інтернет-магазин).
 *
 * Персональні правила: ліміт 5 одиниць; знижка 17% від 1000 грн (100000 коп.) включно;
 * повернення до 3 днів включно лише із закритим пакуванням.
 *
 * Запуск (API піднімається самим тестом на вільному порту):
 *     npm test -- tests/api.test.js
 * Для вже запущеного API (npm start) задайте API_URL, напр. http://127.0.0.1:8080.
 * Потрібні змінні DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (як в README).
 */
const { createApp } = require("../src/api");
const { connect } = require("../src/database");

const RUN = Date.now().toString(36);
const NOT_EXISTING_ID = 9007199254740991; // Number.MAX_SAFE_INTEGER — валідний id, якого немає в БД
let seq = 0;
const uid = (prefix) => `${prefix}-${RUN}-${++seq}`;

let server;
let baseUrl;

beforeAll(async () => {
    if (process.env.API_URL) {
        baseUrl = process.env.API_URL.replace(/\/$/, "");
        return;
    }
    server = createApp().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
    // Прибирання даних цього запуску (замовлення — перед товарами).
    try {
        const client = await connect();
        try {
            await client.query("DELETE FROM orders WHERE reference LIKE $1", [`%-${RUN}-%`]);
            await client.query("DELETE FROM products WHERE sku LIKE $1", [`%-${RUN}-%`]);
        } finally {
            await client.end();
        }
    } catch (error) {
        console.warn("Не вдалося прибрати тестові дані:", error.message);
    }
});

// ---------- допоміжні функції ----------

async function call(method, path, body) {
    const hasBody = body !== undefined;
    const response = await fetch(baseUrl + path, {
        method,
        headers: hasBody ? { "Content-Type": "application/json" } : {},
        body: hasBody ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
    return { status: response.status, headers: response.headers, body: json };
}

async function createProduct(overrides = {}) {
    const response = await call("POST", "/products", {
        sku: uid("SKU"), unitPrice: 60000, stock: 10, onSale: false, ...overrides
    });
    expect(response.status).toBe(201);
    return response.body;
}

function postOrder(productId, overrides = {}) {
    return call("POST", "/orders", {
        reference: uid("ORD"), productId, quantity: 1, premium: false, ...overrides
    });
}

async function createOrder(productId, overrides = {}) {
    const response = await postOrder(productId, overrides);
    expect(response.status).toBe(201);
    return response.body;
}

function returnOrder(orderId, daysSincePurchase = 1, packagingOpen = false) {
    return call("POST", `/orders/${orderId}/return`, { daysSincePurchase, packagingOpen });
}

/** Перевіряє error contract: статус, рівно поля code і message, очікуваний code. */
function expectError(response, status, code) {
    expect(response.status).toBe(status);
    expect(response.body).not.toBeNull();
    expect(Object.keys(response.body).sort()).toEqual(["code", "message"]);
    expect(response.body.code).toBe(code);
    expect(typeof response.body.message).toBe("string");
    expect(response.body.message.length).toBeGreaterThan(0);
}

// ---------- 1–2. POST і GET за id ----------

describe("Створення та читання ресурсів", () => {
    test("POST /products → 201, Location, id і поля відповіді", async () => {
        const sku = uid("SKU");
        const response = await call("POST", "/products", { sku, unitPrice: 60000, stock: 10, onSale: true });

        expect(response.status).toBe(201);
        expect(typeof response.body.id).toBe("number");
        expect(response.body).toEqual({ id: response.body.id, sku, unitPrice: 60000, stock: 10, onSale: true });
        expect(response.headers.get("location")).toBe(`/products/${response.body.id}`);
    });

    test("POST /orders → 201, id, статус CONFIRMED, сума за персональним правилом", async () => {
        const product = await createProduct({ unitPrice: 60000, onSale: false });
        const reference = uid("ORD");
        const response = await call("POST", "/orders", {
            reference, productId: product.id, quantity: 2, premium: true
        });

        expect(response.status).toBe(201);
        const order = response.body;
        expect(typeof order.id).toBe("number");
        expect(order.reference).toBe(reference);
        expect(order.premium).toBe(true);
        expect(order.couponValid).toBe(false);
        expect(order.status).toBe("CONFIRMED");
        expect(order.total).toBe(99600); // 120000 коп. − floor(17%) = 120000 − 20400
        expect(order.item).toEqual({
            id: order.item.id, productId: product.id, quantity: 2, unitPrice: 60000, onSale: false
        });
        expect(response.headers.get("location")).toBe(`/orders/${order.id}`);
    });

    test("GET /orders/{id} → 200, дані збігаються зі створеним замовленням", async () => {
        const product = await createProduct();
        const created = await createOrder(product.id, { quantity: 3, premium: true });

        const response = await call("GET", `/orders/${created.id}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual(created);
    });

    test("GET /products/{id} → 200, а залишок після оформлення не змінюється", async () => {
        const product = await createProduct({ stock: 10 });
        await createOrder(product.id, { quantity: 4 });

        const response = await call("GET", `/products/${product.id}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual(product);
    });
});

// ---------- 3. 404 ----------

describe("Неіснуючі ресурси → 404", () => {
    test("GET /orders/{неіснуючий id} → 404 NOT_FOUND з code і message", async () => {
        const response = await call("GET", `/orders/${NOT_EXISTING_ID}`);
        expectError(response, 404, "NOT_FOUND");
        expect(response.body.message).toBe("Замовлення не знайдено");
    });

    test("GET /products/{неіснуючий id} → 404 NOT_FOUND", async () => {
        const response = await call("GET", `/products/${NOT_EXISTING_ID}`);
        expectError(response, 404, "NOT_FOUND");
        expect(response.body.message).toBe("Товар не знайдено");
    });

    test("POST /orders з неіснуючим товаром → 404 NOT_FOUND", async () => {
        const response = await postOrder(NOT_EXISTING_ID);
        expectError(response, 404, "NOT_FOUND");
    });

    test("POST /orders/{неіснуючий id}/return → 404 NOT_FOUND", async () => {
        const response = await returnOrder(NOT_EXISTING_ID, 1);
        expectError(response, 404, "NOT_FOUND");
    });
});

// ---------- 4–6. Action endpoint, 409, незмінність ----------

describe("Повернення замовлення (action endpoint)", () => {
    test("POST /orders/{id}/return → 200, статус RETURNED, total збережена; GET підтверджує", async () => {
        const product = await createProduct();
        const order = await createOrder(product.id, { quantity: 2 });

        const response = await returnOrder(order.id, 2, false);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ...order, status: "RETURNED" });

        const after = await call("GET", `/orders/${order.id}`);
        expect(after.status).toBe(200);
        expect(after.body.status).toBe("RETURNED");
        expect(after.body.total).toBe(order.total);
    });

    test("повторне повернення → 409 ORDER_CONFLICT, а наступний GET не змінився", async () => {
        const product = await createProduct();
        const order = await createOrder(product.id);
        expect((await returnOrder(order.id, 1)).status).toBe(200);
        const snapshot = (await call("GET", `/orders/${order.id}`)).body;

        const repeated = await returnOrder(order.id, 1);

        expectError(repeated, 409, "ORDER_CONFLICT");
        expect(repeated.body.message).toBe("Замовлення вже повернено");
        const after = await call("GET", `/orders/${order.id}`);
        expect(after.status).toBe(200);
        expect(after.body).toEqual(snapshot);
        expect(after.body.status).toBe("RETURNED");
    });

    test.each([
        ["минуло 4 дні (понад 3)", 4, false],
        ["пакування відкрите", 1, true],
        ["і 4 дні, і відкрите пакування", 10, true]
    ])("заборонене повернення (%s) → 409, замовлення залишається CONFIRMED", async (_name, days, open) => {
        const product = await createProduct();
        const order = await createOrder(product.id);
        const before = (await call("GET", `/orders/${order.id}`)).body;

        const rejected = await returnOrder(order.id, days, open);

        expectError(rejected, 409, "ORDER_CONFLICT");
        expect(rejected.body.message).toBe("Повернення не дозволене");
        const after = await call("GET", `/orders/${order.id}`);
        expect(after.status).toBe(200);
        expect(after.body).toEqual(before);
        expect(after.body.status).toBe("CONFIRMED");
    });
});

// ---------- 7. Персональне бізнес-правило ----------

describe("Персональне бізнес-правило: ліміт кількості (до 5 включно)", () => {
    test.each([
        [1, 201],
        [5, 201], // межа: 5 — дозволено
        [6, 409], // межа: 6 — перевищено
        [20, 409] // максимум валідної кількості, але понад ліміт
    ])("кількість %i → HTTP %i", async (quantity, expectedStatus) => {
        const product = await createProduct({ stock: 100 });

        const response = await postOrder(product.id, { quantity });

        if (expectedStatus === 201) {
            expect(response.status).toBe(201);
            expect(response.body.item.quantity).toBe(quantity);
            expect(response.body.status).toBe("CONFIRMED");
        } else {
            expectError(response, 409, "ORDER_CONFLICT");
            expect(response.body.message).toBe("Перевищено ліміт кількості");
        }
    });

    test("відхилене замовлення не зберігається: той самий reference можна використати знову", async () => {
        const product = await createProduct({ stock: 100 });
        const reference = uid("ORD");

        const rejected = await postOrder(product.id, { reference, quantity: 6 });
        expectError(rejected, 409, "ORDER_CONFLICT");

        const retry = await postOrder(product.id, { reference, quantity: 5 });
        expect(retry.status).toBe(201); // якби перше замовлення збереглося — було б 409 DUPLICATE_RESOURCE
        expect(retry.body.reference).toBe(reference);
    });
});

describe("Персональне бізнес-правило: знижка 17% від 1000 грн включно", () => {
    test.each([
        // [ціна, кількість, premium, акційний, очікувана total, опис]
        [99999, 1, false, false, 99999, "999,99 грн — знижки немає"],
        [100000, 1, false, false, 83000, "рівно 1000 грн — знижка діє (межа включно)"],
        [33333, 3, false, false, 99999, "99999 коп. — знижки немає (на 1 коп. нижче межі)"],
        [33334, 3, false, false, 83002, "100002 коп. — знижка, округлення донизу (17000,34 → 17000)"],
        [100001, 1, false, false, 83001, "100001 коп. — знижка, округлення донизу (17000,17 → 17000)"],
        [20000, 5, false, false, 83000, "ліміт 5 × 200 грн = 1000 грн — знижка діє"],
        [99999, 1, true, false, 99999, "преміальність не дає знижки нижче порогу"],
        [100000, 1, true, false, 83000, "преміальність не змінює знижку"],
        [100000, 1, false, true, 83000, "акційність не змінює знижку"]
    ])("ціна %i коп. × %i, premium=%s, onSale=%s → total %i (%s)",
        async (unitPrice, quantity, premium, onSale, expectedTotal) => {
            const product = await createProduct({ unitPrice, onSale });

            const response = await postOrder(product.id, { quantity, premium });

            expect(response.status).toBe(201);
            expect(response.body.total).toBe(expectedTotal);

            const stored = await call("GET", `/orders/${response.body.id}`);
            expect(stored.body.total).toBe(expectedTotal); // у БД збережена та сама сума
        });
});

describe("Персональне бізнес-правило: повернення (до 3 днів включно, лише закрите пакування)", () => {
    test.each([
        [0, false, 200, "день покупки"],
        [3, false, 200, "межа: 3 дні включно"],
        [4, false, 409, "межа: 4 дні — забагато"],
        [0, true, 409, "пакування відкрите"],
        [3, true, 409, "межа за днями, але пакування відкрите"]
    ])("дні=%i, packagingOpen=%s → HTTP %i (%s)", async (days, packagingOpen, expectedStatus) => {
        const product = await createProduct();
        const order = await createOrder(product.id);

        const response = await returnOrder(order.id, days, packagingOpen);

        expect(response.status).toBe(expectedStatus);
        if (expectedStatus === 200) {
            expect(response.body.status).toBe("RETURNED");
        } else {
            expectError(response, 409, "ORDER_CONFLICT");
        }
        const after = await call("GET", `/orders/${order.id}`);
        expect(after.body.status).toBe(expectedStatus === 200 ? "RETURNED" : "CONFIRMED");
    });

    test("акційність не обмежує повернення", async () => {
        const product = await createProduct({ onSale: true });
        const order = await createOrder(product.id);
        expect(order.item.onSale).toBe(true);

        const response = await returnOrder(order.id, 2, false);

        expect(response.status).toBe(200);
        expect(response.body.status).toBe("RETURNED");
    });
});

// ---------- 8. Workflow ----------

describe("Workflow: POST → GET → action → GET", () => {
    test("id передається динамічно з попередніх відповідей", async () => {
        // 1) POST товар → productId із відповіді
        const productResponse = await call("POST", "/products", {
            sku: uid("SKU"), unitPrice: 50000, stock: 20, onSale: false
        });
        expect(productResponse.status).toBe(201);
        const productId = productResponse.body.id;

        // 2) POST замовлення з productId, отриманим на кроці 1
        const createResponse = await call("POST", "/orders", {
            reference: uid("ORD"), productId, quantity: 3, premium: false
        });
        expect(createResponse.status).toBe(201);
        const orderId = Number(createResponse.headers.get("location").split("/").pop());
        expect(orderId).toBe(createResponse.body.id);
        expect(createResponse.body.total).toBe(124500); // 150000 − floor(150000·17/100)=25500

        // 3) GET за id із Location
        const firstGet = await call("GET", `/orders/${orderId}`);
        expect(firstGet.status).toBe(200);
        expect(firstGet.body.status).toBe("CONFIRMED");
        expect(firstGet.body.item.productId).toBe(productId);

        // 4) action — повернення
        const action = await call("POST", `/orders/${orderId}/return`, { daysSincePurchase: 0, packagingOpen: false });
        expect(action.status).toBe(200);
        expect(action.body.status).toBe("RETURNED");

        // 5) GET — новий стан збережено, total не змінилась
        const secondGet = await call("GET", `/orders/${orderId}`);
        expect(secondGet.status).toBe(200);
        expect(secondGet.body).toEqual({ ...firstGet.body, status: "RETURNED" });
    });
});

// ---------- додаткові перевірки error contract ----------

describe("Інші помилки API", () => {
    test("повторний reference → 409 DUPLICATE_RESOURCE", async () => {
        const product = await createProduct();
        const reference = uid("ORD");
        expect((await postOrder(product.id, { reference })).status).toBe(201);

        const duplicate = await postOrder(product.id, { reference });

        expectError(duplicate, 409, "DUPLICATE_RESOURCE");
    });

    test("кількість більша за залишок (у межах ліміту) → 409 ORDER_CONFLICT", async () => {
        const product = await createProduct({ stock: 2 });

        const response = await postOrder(product.id, { quantity: 3 });

        expectError(response, 409, "ORDER_CONFLICT");
        expect(response.body.message).toBe("Недостатньо товару");
    });

    test.each([
        ["ціна менша за мінімальну", { unitPrice: 99 }],
        ["порожній sku", { sku: "   " }],
        ["від’ємний залишок", { stock: -1 }],
        ["onSale не boolean", { onSale: "yes" }]
    ])("POST /products: %s → 400 INVALID_REQUEST", async (_name, overrides) => {
        const response = await call("POST", "/products", {
            sku: uid("SKU"), unitPrice: 60000, stock: 10, onSale: false, ...overrides
        });
        expectError(response, 400, "INVALID_REQUEST");
    });

    test.each([
        ["кількість 0", { quantity: 0 }],
        ["кількість 21 (поза діапазоном 1–20)", { quantity: 21 }],
        ["premium не boolean", { premium: "true" }]
    ])("POST /orders: %s → 400 INVALID_REQUEST", async (_name, overrides) => {
        const product = await createProduct({ stock: 100 });
        const response = await postOrder(product.id, overrides);
        expectError(response, 400, "INVALID_REQUEST");
    });

    test("POST /orders/{id}/return без daysSincePurchase → 400, а замовлення не змінюється", async () => {
        const product = await createProduct();
        const order = await createOrder(product.id);

        const response = await call("POST", `/orders/${order.id}/return`, { packagingOpen: false });

        expectError(response, 400, "INVALID_REQUEST");
        const after = await call("GET", `/orders/${order.id}`);
        expect(after.body).toEqual(order);
    });

    test("некоректний JSON → 400 INVALID_REQUEST", async () => {
        const response = await call("POST", "/products", "{ not-json");
        expectError(response, 400, "INVALID_REQUEST");
    });

    test("GET /orders/abc → 400 INVALID_REQUEST (некоректний id)", async () => {
        const response = await call("GET", "/orders/abc");
        expectError(response, 400, "INVALID_REQUEST");
    });

    test("непідтримуваний метод → 405 з Allow", async () => {
        const response = await call("DELETE", "/orders/1");
        expectError(response, 405, "METHOD_NOT_ALLOWED");
        expect(response.headers.get("allow")).toBe("GET");
    });
});
