"use strict";
/**
 * Unit tests of OrderService: no database, no network.
 * Repositories are in-memory fakes, the external policy is a stub (jest.fn).
 */
const { Product, Order, OrderItem, OrderRequest, OrderStatus: S } = require("../../src/models");
const { OrderService, OrderRejectedError, ResourceNotFoundError } = require("../../src/service");

class FakeProducts {
    constructor(items) { this.byId = new Map(items.map(p => [p.id, p])); }
    async findById(id) { return this.byId.get(id) || null; }
}
class FakeOrders {
    constructor() { this.byId = new Map(); this.seq = 0; }
    async create(o) {
        const id = ++this.seq;
        const saved = new Order(id, o.reference, o.premium, o.couponValid, o.total, o.status,
            new OrderItem(id, o.item.productId, o.item.quantity, o.item.unitPrice, o.item.onSale));
        this.byId.set(id, saved);
        return saved;
    }
    async findById(id) { return this.byId.get(id) || null; }
    async updateStatus(id, status) {
        const o = this.byId.get(id);
        this.byId.set(id, new Order(o.id, o.reference, o.premium, o.couponValid, o.total, status, o.item));
    }
    get size() { return this.byId.size; }
}

function make({ stock = 5, unitPrice = 10000, onSale = false, allowed = true } = {}) {
    const product = new Product(1, "SKU-1", unitPrice, stock, onSale);
    const orders = new FakeOrders();
    const policy = { isAllowed: jest.fn(async () => allowed) };
    const service = new OrderService(new FakeProducts([product]), orders, policy);
    return { product, orders, policy, service };
}
const request = (quantity = 1, premium = false, reference = "REF-1", productId = 1) =>
    new OrderRequest(reference, productId, quantity, premium);

describe("calculateTotal (personal rule: 17% discount from 1000 UAH, rounded down)", () => {
    const { service } = make();
    test.each([
        [99999, 1, false, 99999, "999.99 UAH - no discount"],
        [100000, 1, false, 83000, "exactly 1000 UAH - discount applies"],
        [100001, 1, false, 83001, "discount 17000.17 rounded down"],
        [33333, 3, false, 99999, "99999 kopecks - no discount"],
        [33334, 3, false, 83002, "100002 kopecks - discount 17000.34 rounded down"],
        [20000, 5, false, 83000, "limit quantity 5 reaches the threshold"],
        [99999, 1, true, 99999, "premium gives no discount below the threshold"],
        [100000, 1, true, 83000, "premium does not change the discount"]
    ])("price %i x %i, premium=%s -> %i (%s)", (price, quantity, premium, expected) => {
        expect(service.calculateTotal(price, quantity, premium)).toBe(expected);
    });

    test.each([
        ["price below minimum", () => service.calculateTotal(99, 1, false), RangeError],
        ["price above maximum", () => service.calculateTotal(1000001, 1, false), RangeError],
        ["quantity 0", () => service.calculateTotal(10000, 0, false), RangeError],
        ["quantity 21", () => service.calculateTotal(10000, 21, false), RangeError],
        ["premium is not boolean", () => service.calculateTotal(10000, 1, "true"), TypeError]
    ])("invalid input: %s", (_name, call, errorType) => {
        expect(call).toThrow(errorType);
    });
});

describe("placeOrder", () => {
    test("saves a CONFIRMED order with calculated total and a snapshot of price and promo flag", async () => {
        const { service, orders } = make({ unitPrice: 60000, onSale: true, stock: 10 });
        const saved = await service.placeOrder(request(2, true));
        expect(saved.status).toBe(S.CONFIRMED);
        expect(saved.total).toBe(99600); // 120000 - floor(17%) = 120000 - 20400
        expect(saved.couponValid).toBe(false);
        expect(saved.item).toMatchObject({ productId: 1, quantity: 2, unitPrice: 60000, onSale: true });
        expect(await orders.findById(saved.id)).toEqual(saved);
    });

    test.each([[1, true], [5, true], [6, false], [20, false]])(
        "quantity %i is %s by the personal limit of 5", async (quantity, allowedByLimit) => {
            const { service, orders, policy } = make({ stock: 100 });
            if (allowedByLimit) {
                await expect(service.placeOrder(request(quantity))).resolves.toMatchObject({ status: S.CONFIRMED });
            } else {
                await expect(service.placeOrder(request(quantity))).rejects.toBeInstanceOf(OrderRejectedError);
                expect(policy.isAllowed).not.toHaveBeenCalled();
                expect(orders.size).toBe(0);
            }
        });

    test("not enough stock -> OrderRejectedError, policy is not called, nothing saved", async () => {
        const { service, orders, policy } = make({ stock: 2 });
        await expect(service.placeOrder(request(3))).rejects.toBeInstanceOf(OrderRejectedError);
        expect(policy.isAllowed).not.toHaveBeenCalled();
        expect(orders.size).toBe(0);
    });

    test("policy is asked exactly once, with the product and the quantity", async () => {
        const { service, policy, product } = make({ stock: 5 });
        await service.placeOrder(request(3));
        expect(policy.isAllowed).toHaveBeenCalledTimes(1);
        expect(policy.isAllowed).toHaveBeenCalledWith(product, 3);
    });

    test("policy denies -> OrderRejectedError, nothing saved", async () => {
        const { service, orders } = make({ allowed: false });
        await expect(service.placeOrder(request())).rejects.toBeInstanceOf(OrderRejectedError);
        expect(orders.size).toBe(0);
    });

    test("policy returns a non-boolean -> TypeError, nothing saved", async () => {
        const { service, orders, policy } = make();
        policy.isAllowed.mockResolvedValue("true");
        await expect(service.placeOrder(request())).rejects.toBeInstanceOf(TypeError);
        expect(orders.size).toBe(0);
    });

    test("unknown product -> ResourceNotFoundError", async () => {
        const { service } = make();
        await expect(service.placeOrder(request(1, false, "REF-X", 999))).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    test.each([
        ["not an OrderRequest", { reference: "R", productId: 1, quantity: 1, premium: false }, TypeError],
        ["empty reference", request(1, false, "   "), RangeError],
        ["reference longer than 40 characters", request(1, false, "x".repeat(41)), RangeError],
        ["premium is not boolean", new OrderRequest("REF-1", 1, 1, "no"), TypeError],
        ["quantity is not an integer", request(1.5), RangeError]
    ])("invalid request: %s", async (_name, input, errorType) => {
        const { service } = make();
        await expect(service.placeOrder(input)).rejects.toBeInstanceOf(errorType);
    });

    test("all dependencies are required", () => {
        expect(() => new OrderService(null, new FakeOrders(), {})).toThrow(TypeError);
    });
});

describe("returnOrder (personal rule: up to 3 days inclusive, only with closed packaging)", () => {
    async function confirmed(options) {
        const ctx = make(options);
        const saved = await ctx.service.placeOrder(request());
        return { ...ctx, saved };
    }

    test.each([[0], [3]])("allowed after %i day(s) with closed packaging -> RETURNED", async days => {
        const { service, orders, saved } = await confirmed();
        const returned = await service.returnOrder(saved.id, days, false);
        expect(returned.status).toBe(S.RETURNED);
        expect((await orders.findById(saved.id)).status).toBe(S.RETURNED);
    });

    test.each([
        ["4 days (over the limit)", 4, false],
        ["packaging is open", 0, true],
        ["3 days but packaging is open", 3, true]
    ])("rejected: %s -> order stays CONFIRMED", async (_name, days, open) => {
        const { service, orders, saved } = await confirmed();
        await expect(service.returnOrder(saved.id, days, open)).rejects.toBeInstanceOf(OrderRejectedError);
        expect((await orders.findById(saved.id)).status).toBe(S.CONFIRMED);
    });

    test("repeated return is rejected and does not change the order", async () => {
        const { service, orders, saved } = await confirmed();
        const returned = await service.returnOrder(saved.id, 0, false);
        await expect(service.returnOrder(saved.id, 0, false)).rejects.toBeInstanceOf(OrderRejectedError);
        expect(await orders.findById(saved.id)).toEqual(returned);
    });

    test("promotional items can be returned", async () => {
        const { service, saved } = await confirmed({ onSale: true });
        expect((await service.returnOrder(saved.id, 1, false)).status).toBe(S.RETURNED);
    });

    test("return does not call the external policy", async () => {
        const { service, policy, saved } = await confirmed();
        policy.isAllowed.mockClear();
        await service.returnOrder(saved.id, 0, false);
        expect(policy.isAllowed).not.toHaveBeenCalled();
    });

    test("unknown order -> ResourceNotFoundError", async () => {
        const { service } = make();
        await expect(service.returnOrder(999, 0, false)).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    test.each([[-1], [36501], [1.5]])("invalid number of days %p -> RangeError", async days => {
        const { service, saved } = await confirmed();
        await expect(service.returnOrder(saved.id, days, false)).rejects.toBeInstanceOf(RangeError);
    });
});
