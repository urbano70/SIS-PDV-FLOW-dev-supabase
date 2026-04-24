# Firestore Security Specification

## 1. Data Invariants
- An Order must have a valid `tableId`.
- A PizzaItem must belong to an Order.
- Stock quantities cannot be negative.
- Waiters must be approved by an Admin to perform writes.
- Orders have immutable `tableId` once created.

## 2. The "Dirty Dozen" Payloads (Deny Cases)

1. **Identity Spoofing**: Attempt to create an order as another waiter.
   - Payload: `{ waiterId: "other_suit", items: [...], status: "pending" }`
2. **State Shortcutting**: Attempt to update an order directly to "finalizada" without payment logic.
   - Payload: `{ status: "finalizada" }` (Should be blocked if not done via payment action keys)
3. **Resource Poisoning**: Large string ID injection.
   - Path: `/tables/very-long-id-string-exceeding-128-chars...`
4. **Price Manipulation**: Updating item price in an order.
   - Payload: `{ "items[0].price": 0.01 }`
5. **Unauthorized Approval**: A pending waiter approving themselves.
   - Payload: `{ status: "approved" }`
6. **Negative Stock**: Setting stock to negative.
   - Payload: `{ quantity: -10 }`
7. **Bypassing Verification**: Writing as an unverified user.
   - Auth: `{ email_verified: false }`
8. **Shadow Field Injection**: Adding `isAdmin: true` to a waiter profile.
   - Payload: `{ isAdmin: true }`
9. **Relational Sync Break**: Creating an order for a non-existent table.
   - Constraint: `exists(/databases/$(database)/documents/tables/$(tableId))`
10. **PII Leak**: Non-admin reading waiter phone/CPF.
    - Action: `get` on `/waiters/{id}`
11. **Mass Delete**: Attempting to delete the entire `orders` collection.
    - Action: `delete` without specific ID logic.
12. **Status Lock Break**: Updating a "finalizada" order.

## 3. Test Runner (Mock Logic)
The `firestore.rules` will be verified against these patterns.
