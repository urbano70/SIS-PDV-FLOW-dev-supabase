import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { createServer as createViteServer } from "vite";
import { MENU_CATEGORIES, PIZZA_FLAVORS, PIZZA_CRUSTS } from "./src/constants.ts";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  app.use(express.json());

  // In-memory state
  let waiters = [];
  let orders = [];
  let isCashRegisterOpen = false;
  let tables = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    status: "free", // free, occupied, bill_requested, linked
    currentOrder: null,
    linkedTo: null,
  }));

  let comandas = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    status: "free",
    currentOrder: null,
    linkedTo: null,
  }));

  // Daily order counter state
  let dailyCounter = 0;
  let lastOrderDate = "";

  const generateOrderId = () => {
    const now = new Date();
    // Use local date for the ID (DDMMYYYY)
    const dateStr = now.getDate().toString().padStart(2, '0') + 
                    (now.getMonth() + 1).toString().padStart(2, '0') + 
                    now.getFullYear().toString();
    
    // Reset counter if the date has changed
    if (dateStr !== lastOrderDate) {
      dailyCounter = 1;
      lastOrderDate = dateStr;
    } else {
      dailyCounter++;
    }
    
    // Format: DDMMYYYY0001
    return `${dateStr}${dailyCounter.toString().padStart(4, '0')}`;
  };

  let stock = [
    { id: "1", name: "Farinha de Trigo", quantity: 50, unit: "kg", minQuantity: 10 },
    { id: "2", name: "Queijo Mussarela", quantity: 30, unit: "kg", minQuantity: 5 },
    { id: "3", name: "Molho de Tomate", quantity: 20, unit: "L", minQuantity: 4 },
    { id: "4", name: "Calabresa", quantity: 15, unit: "kg", minQuantity: 3 },
    { id: "5", name: "Frango Desfiado", quantity: 12, unit: "kg", minQuantity: 3 },
    { id: "6", name: "Bacon", quantity: 10, unit: "kg", minQuantity: 2 },
    { id: "7", name: "Catupiry", quantity: 8, unit: "kg", minQuantity: 2 },
    { id: "8", name: "Camarão", quantity: 5, unit: "kg", minQuantity: 1 },
    { id: "9", name: "Pão de Hambúrguer", quantity: 50, unit: "un", minQuantity: 10 },
    { id: "10", name: "Hambúrguer de Carne", quantity: 40, unit: "un", minQuantity: 8 },
    { id: "11", name: "Presunto", quantity: 10, unit: "kg", minQuantity: 2 },
  ];

  let menu = JSON.parse(JSON.stringify(MENU_CATEGORIES));
  let pizzaFlavors = JSON.parse(JSON.stringify(PIZZA_FLAVORS));
  let pizzaCrusts = JSON.parse(JSON.stringify(PIZZA_CRUSTS));

  // Socket.io logic
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.emit("init_data", {
      waiters,
      orders,
      tables,
      comandas,
      stock,
      menu,
      pizzaFlavors,
      pizzaCrusts,
      isCashRegisterOpen
    });

    socket.on("waiter_register", (waiterData) => {
      // Find by CPF or Name/Phone combination if CPF is missing
      const existingWaiterIndex = waiters.findIndex(w => 
        (waiterData.cpf && w.cpf === waiterData.cpf) || 
        (waiterData.name === w.name && waiterData.phone === w.phone)
      );
      
      const waiterId = waiterData.cpf || Math.random().toString(36).substr(2, 9);
      const waiter = { 
        ...waiterData, 
        id: waiterId,
        socketId: socket.id, 
        status: "pending" 
      };
      
      // Store waiter identity on the socket
      (socket as any).waiterId = waiterId;
      
      if (existingWaiterIndex !== -1) {
        waiters[existingWaiterIndex] = { ...waiters[existingWaiterIndex], ...waiter, status: waiters[existingWaiterIndex].status };
      } else {
        waiters.push(waiter);
      }

      io.emit("admin_notification", {
        type: "NEW_WAITER",
        data: waiter,
      });
      io.emit("update_waiters", waiters);
    });

    socket.on("waiter_login", ({ name, password }) => {
      const waiter = waiters.find(w => w.name === name && w.password === password);
      if (waiter) {
        waiter.socketId = socket.id;
        // Store waiter identity on the socket
        (socket as any).waiterId = waiter.id;
        
        socket.emit("waiter_approved", { status: waiter.status });
        io.emit("update_waiters", waiters);
      } else {
        socket.emit("login_error", "Nome ou senha incorretos.");
      }
    });

    socket.on("toggle_cash_register", (isOpen) => {
      if (!isOpen) {
        // Check for occupied tables or comandas
        const activeTables = tables.find(t => t.status !== "free");
        const activeComandas = comandas.find(c => c.status !== "free");
        
        if (activeTables || activeComandas) {
          socket.emit("error_message", "Não é possível fechar o caixa com mesas ou comandas ocupadas.");
          return;
        }
      }
      isCashRegisterOpen = isOpen;
      io.emit("update_cash_register", isCashRegisterOpen);
    });

    socket.emit("update_menu", menu);

    socket.on("toggle_waiter_status", ({ waiterId, status }) => {
      const waiter = waiters.find((w) => w.id === waiterId || w.cpf === waiterId);
      if (waiter) {
        waiter.status = status;
        io.emit("update_waiters", waiters);
        
        // Notify the waiter via ALL their connected sockets
        const connectedSockets = io.sockets.sockets;
        connectedSockets.forEach((s) => {
          if ((s as any).waiterId === waiter.id) {
            s.emit("waiter_status_changed", { status });
            // If they are inactive, we can also disconnect them or just let the client handle it
            // For now, let's just emit the status changed event which App.tsx handles
          }
        });
      }
    });

    socket.on("admin_approve_waiter", (waiterId) => {
      const waiter = waiters.find((w) => w.id === waiterId || w.cpf === waiterId);
      if (waiter) {
        waiter.status = "approved";
        io.emit("update_waiters", waiters);
        
        // Notify the waiter via ALL their connected sockets
        const connectedSockets = io.sockets.sockets;
        connectedSockets.forEach((s) => {
          if ((s as any).waiterId === waiter.id) {
            s.emit("waiter_approved", { status: "approved" });
          }
        });
      }
    });

    socket.on("new_order", (orderData) => {
      if (!isCashRegisterOpen) {
        socket.emit("error_message", "O caixa está fechado. Abra o caixa para realizar pedidos.");
        return;
      }
      
      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? waiters.find(w => w.id === waiterId) : null;
      
      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso está inativo. Entre em contato com o gerente.");
        return;
      }

      const isComanda = orderData.isComanda;
      const targetList = isComanda ? comandas : tables;
      let table = targetList.find(t => t.id === orderData.tableId);
      
      // Handle linked tables
      if (table && table.status === "linked" && table.linkedTo) {
        let currentTable = table;
        const visited = new Set([currentTable.id]);
        while (currentTable.status === "linked" && currentTable.linkedTo) {
          const nextTable = targetList.find(t => t.id === currentTable.linkedTo);
          if (!nextTable || visited.has(nextTable.id)) break;
          currentTable = nextTable;
          visited.add(currentTable.id);
        }
        table = currentTable;
      }

      const waiterName = orderData.waiterName || (waiter ? waiter.name : "Desconhecido");

      // Tag items with waiter name
      const itemsWithWaiter = orderData.items.map(item => ({
        ...item,
        waiterName: item.waiterName || waiterName,
        timestamp: new Date().toISOString()
      }));

      if (table && table.status === "occupied" && table.currentOrder) {
        const existingOrder = orders.find(o => o.id === table.currentOrder);
        if (existingOrder) {
          existingOrder.items.push(...itemsWithWaiter);
          if (orderData.observations) {
            existingOrder.observations = existingOrder.observations 
              ? `${existingOrder.observations} | ${orderData.observations}` 
              : orderData.observations;
          }
          io.emit("update_orders", orders);
          return;
        }
      }

      const newOrder = { 
        ...orderData, 
        items: itemsWithWaiter,
        id: generateOrderId(), 
        status: "pending", 
        timestamp: new Date().toISOString(),
        waiterName: waiterName,
        isComanda: !!isComanda
      };
      orders.push(newOrder);
      
      if (table) {
        const orderId = newOrder.id;
        const targetId = table.id;
        
        // Update the main table and all tables/comandas linked to it
        const updateEntity = (t) => {
          if (t.id === targetId || t.linkedTo === targetId) {
            t.status = t.id === targetId ? "occupied" : "linked";
            t.currentOrder = orderId;
          }
        };

        if (isComanda) {
          comandas.forEach(updateEntity);
        } else {
          tables.forEach(updateEntity);
        }
      }

      // Dynamic stock reduction
      orderData.items.forEach(item => {
        stock = stock.map(s => {
          let reduction = 0;
          const itemName = item.name.toLowerCase();
          if (!itemName.includes("x-") && !["coca", "suco", "cerveja", "água", "guaraná"].some(b => itemName.includes(b))) {
            if (s.name === "Farinha de Trigo") reduction = 0.3;
            if (s.name === "Queijo Mussarela") reduction = 0.2;
            if (s.name === "Molho de Tomate") reduction = 0.1;
          }
          if (itemName.startsWith("x-")) {
            if (s.name === "Pão de Hambúrguer") reduction = 1;
            if (s.name === "Hambúrguer de Carne") reduction = 1;
            if (s.name === "Queijo Mussarela") reduction = 0.05;
          }
          if (s.name === "Calabresa" && itemName.includes("calabresa")) reduction += 0.15;
          if (s.name === "Frango Desfiado" && itemName.includes("frango")) reduction += 0.2;
          if (s.name === "Bacon" && itemName.includes("bacon")) reduction += 0.1;
          if (s.name === "Catupiry" && itemName.includes("catupiry")) reduction += 0.15;
          if (s.name === "Camarão" && itemName.includes("camarão")) reduction += 0.25;
          if (s.name === "Presunto" && itemName.includes("presunto")) reduction += 0.1;
          return { ...s, quantity: Math.max(0, s.quantity - reduction) };
        });
      });

      io.emit("update_orders", orders);
      if (isComanda) {
        io.emit("update_comandas", comandas);
      } else {
        io.emit("update_tables", tables);
      }
      io.emit("update_stock", stock);
      io.emit("kitchen_new_order", newOrder);
    });

    socket.on("update_product", ({ categoryName, productId, updatedData }) => {
      menu = menu.map(cat => {
        if (cat.name === categoryName) {
          return {
            ...cat,
            items: cat.items.map(item => {
              if (item.id === productId) {
                return { ...item, ...updatedData };
              }
              return item;
            })
          };
        }
        return cat;
      });
      io.emit("update_menu", menu);
    });

    socket.on("add_product", ({ categoryName, productData }) => {
      menu = menu.map(cat => {
        if (cat.name === categoryName) {
          const newItem = {
            id: Math.random().toString(36).substr(2, 9),
            ...productData
          };
          return {
            ...cat,
            items: [...cat.items, newItem]
          };
        }
        return cat;
      });
      io.emit("update_menu", menu);
    });

    socket.on("add_category", (categoryData) => {
      const newCategory = {
        name: categoryData.name,
        type: categoryData.type || "lanches",
        items: []
      };
      menu.push(newCategory);
      io.emit("update_menu", menu);
    });

    socket.on("update_category", ({ oldName, updatedData }) => {
      menu = menu.map(cat => {
        if (cat.name === oldName) {
          return { ...cat, ...updatedData };
        }
        return cat;
      });
      io.emit("update_menu", menu);
    });

    socket.on("delete_category", (categoryName) => {
      menu = menu.filter(cat => cat.name !== categoryName);
      io.emit("update_menu", menu);
    });

    socket.on("delete_product", ({ categoryName, productId }) => {
      menu = menu.map(cat => {
        if (cat.name === categoryName) {
          return {
            ...cat,
            items: cat.items.filter(item => item.id !== productId)
          };
        }
        return cat;
      });
      io.emit("update_menu", menu);
    });

    socket.on("update_pizza_flavor", ({ flavorName, updatedData }) => {
      pizzaFlavors = pizzaFlavors.map(f => {
        if (f.name === flavorName) {
          return { ...f, ...updatedData };
        }
        return f;
      });
      io.emit("update_pizza_flavors", pizzaFlavors);
    });

    socket.on("add_pizza_flavor", (flavorData) => {
      pizzaFlavors.push(flavorData);
      io.emit("update_pizza_flavors", pizzaFlavors);
    });

    socket.on("delete_pizza_flavor", (flavorName) => {
      pizzaFlavors = pizzaFlavors.filter(f => f.name !== flavorName);
      io.emit("update_pizza_flavors", pizzaFlavors);
    });

    socket.on("update_pizza_crust", ({ oldName, newName }) => {
      pizzaCrusts = pizzaCrusts.map(c => c === oldName ? newName : c);
      io.emit("update_pizza_crusts", pizzaCrusts);
    });

    socket.on("add_pizza_crust", (crustName) => {
      pizzaCrusts.push(crustName);
      io.emit("update_pizza_crusts", pizzaCrusts);
    });

    socket.on("delete_pizza_crust", (crustName) => {
      pizzaCrusts = pizzaCrusts.filter(c => c !== crustName);
      io.emit("update_pizza_crusts", pizzaCrusts);
    });

    socket.on("add_item_to_order", ({ orderId, item }) => {
      if (!isCashRegisterOpen) {
        socket.emit("error_message", "O caixa está fechado. Abra o caixa para adicionar itens.");
        return;
      }

      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? waiters.find(w => w.id === waiterId) : null;

      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso está inativo. Entre em contato com o gerente.");
        return;
      }

      const order = orders.find(o => o.id === orderId);
      if (order) {
        const itemWithTimestamp = { ...item, timestamp: new Date().toISOString() };
        order.items.push(itemWithTimestamp);
        io.emit("update_orders", orders);
        
        // Update stock for the added item
        stock = stock.map(s => {
          let reduction = 0;
          const itemName = itemWithTimestamp.name.toLowerCase();
          if (!itemName.includes("x-") && !["coca", "suco", "cerveja", "água", "guaraná"].some(b => itemName.includes(b))) {
            if (s.name === "Farinha de Trigo") reduction = 0.3;
            if (s.name === "Queijo Mussarela") reduction = 0.2;
            if (s.name === "Molho de Tomate") reduction = 0.1;
          }
          if (itemName.startsWith("x-")) {
            if (s.name === "Pão de Hambúrguer") reduction = 1;
            if (s.name === "Hambúrguer de Carne") reduction = 1;
            if (s.name === "Queijo Mussarela") reduction = 0.05;
          }
          if (s.name === "Calabresa" && itemName.includes("calabresa")) reduction += 0.15;
          if (s.name === "Frango Desfiado" && itemName.includes("frango")) reduction += 0.2;
          if (s.name === "Bacon" && itemName.includes("bacon")) reduction += 0.1;
          if (s.name === "Catupiry" && itemName.includes("catupiry")) reduction += 0.15;
          if (s.name === "Camarão" && itemName.includes("camarão")) reduction += 0.25;
          if (s.name === "Presunto" && itemName.includes("presunto")) reduction += 0.1;
          return { ...s, quantity: Math.max(0, s.quantity - reduction) };
        });
        io.emit("update_stock", stock);
      }
    });

    socket.on("remove_item", ({ orderId, itemId, quantity, reason, removedBy }) => {
      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? waiters.find(w => w.id === waiterId) : null;
      
      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso está inativo. Entre em contato com o gerente.");
        return;
      }

      const order = orders.find(o => o.id == orderId);
      if (order) {
        const itemIndex = order.items.findIndex(i => i.id === itemId);
        if (itemIndex !== -1) {
          const item = order.items[itemIndex];
          const removeQty = quantity || item.quantity || 1;
          const currentQty = item.quantity || 1;

          if (removeQty < currentQty) {
            // Split the item
            const unitPrice = item.price / currentQty;
            const removedItem = {
              ...item,
              id: Math.random().toString(36).substr(2, 9),
              quantity: removeQty,
              price: unitPrice * removeQty,
              removed: true,
              removedBy: removedBy || (waiter ? waiter.name : "Desconhecido"),
              removalReason: reason || ""
            };
            item.quantity = currentQty - removeQty;
            item.price = unitPrice * (currentQty - removeQty);
            order.items.push(removedItem);
          } else {
            // Remove the whole item
            item.removed = true;
            item.removedBy = removedBy || (waiter ? waiter.name : "Desconhecido");
            item.removalReason = reason || "";
          }
          io.emit("update_orders", orders);
        }
      }
    });

    socket.on("pay_items", ({ orderId, selectedItems, partialAmount, paymentMethod }) => {
      const order = orders.find(o => o.id === orderId);
      if (order) {
        if (!order.paymentLog) order.paymentLog = [];
        
        const itemIds = Object.keys(selectedItems);
        const isPartialOnly = itemIds.length === 0;

        if (isPartialOnly && partialAmount) {
          if (!order.partialPayments) order.partialPayments = [];
          const payment = {
            amount: partialAmount,
            method: paymentMethod || "Não informado",
            timestamp: new Date().toISOString()
          };
          order.partialPayments.push(payment);
          order.paymentLog.push({ ...payment, type: 'partial' });
        } else if (itemIds.length > 0) {
          const activeItemsForTotal = order.items.filter(i => !i.removed);
          const selectedItemsTotal = activeItemsForTotal
            .filter(i => selectedItems[i.id] !== undefined)
            .reduce((acc, i) => {
              const qty = selectedItems[i.id];
              const unitPrice = i.price / (i.quantity || 1);
              return acc + (unitPrice * qty);
            }, 0);

          // Use partialAmount if provided (actual amount paid), otherwise fallback to calculated total
          const actualAmountPaid = partialAmount !== undefined ? partialAmount : selectedItemsTotal;

          order.paymentLog.push({
            amount: actualAmountPaid,
            method: paymentMethod || "Não informado",
            timestamp: new Date().toISOString(),
            type: 'items'
          });
          
          itemIds.forEach(itemId => {
            const itemIndex = order.items.findIndex(i => i.id === itemId);
            if (itemIndex !== -1) {
              const item = order.items[itemIndex];
              const payQty = selectedItems[itemId];
              const currentQty = item.quantity || 1;

              if (payQty < currentQty) {
                // Split the item
                const unitPrice = item.price / currentQty;
                const paidItem = {
                  ...item,
                  id: Math.random().toString(36).substr(2, 9),
                  quantity: payQty,
                  price: unitPrice * payQty,
                  paid: true
                };
                item.quantity = currentQty - payQty;
                item.price = unitPrice * (currentQty - payQty);
                order.items.push(paidItem);
              } else {
                // Pay the whole item
                item.paid = true;
              }
            }
          });
        }

        // Check if all active items are paid
        const activeItems = order.items.filter(i => !i.removed);
        const totalItemsPrice = activeItems.reduce((acc, i) => acc + i.price, 0);
        
        let finalTotal = totalItemsPrice;
        if (order.discount) {
          if (order.discountType === 'percentage') finalTotal *= (1 - order.discount / 100);
          else finalTotal = Math.max(0, finalTotal - order.discount);
        }

        const itemsPaidAmount = activeItems.filter(i => i.paid).reduce((acc, i) => acc + i.price, 0);
        const partialPaidAmount = (order.partialPayments || []).reduce((acc, p) => acc + p.amount, 0);
        
        const totalPaid = itemsPaidAmount + partialPaidAmount;

        // If total paid is >= final total, mark order as finished
        if (totalPaid >= finalTotal - 0.01) {
          // Free all tables and comandas associated with this order
          if (order.isComanda) {
            comandas.forEach(c => {
              if (c.currentOrder === order.id) {
                c.status = "free";
                c.currentOrder = null;
                c.linkedTo = null;
              }
            });
          } else {
            tables.forEach(t => {
              if (t.currentOrder === order.id) {
                t.status = "free";
                t.currentOrder = null;
                t.linkedTo = null;
              }
            });
          }

          order.status = "finalizada"; // Mark order as completed
        }

        io.emit("update_orders", orders);
        io.emit("update_comandas", comandas);
        io.emit("update_tables", tables);
      }
    });

    socket.on("link_tables", ({ sourceTableId, targetTableId, isComanda }) => {
      const targetList = isComanda ? comandas : tables;
      const sourceTable = targetList.find(t => t.id === sourceTableId);
      let targetTable = targetList.find(t => t.id === targetTableId);

      if (sourceTable && targetTable) {
        // Find ultimate target if the target is already linked
        const visited = new Set([sourceTable.id, targetTable.id]);
        while (targetTable.status === "linked" && targetTable.linkedTo) {
          const nextTable = targetList.find(t => t.id === targetTable.linkedTo);
          if (!nextTable || visited.has(nextTable.id)) break;
          targetTable = nextTable;
          visited.add(targetTable.id);
        }
        const finalTargetTableId = targetTable.id;

        // If source has an order, transfer items to target
        if (sourceTable.currentOrder) {
          const sourceOrder = orders.find(o => o.id === sourceTable.currentOrder);
          if (sourceOrder) {
            if (targetTable.currentOrder) {
              const targetOrder = orders.find(o => o.id === targetTable.currentOrder);
              if (targetOrder) {
                targetOrder.items.push(...sourceOrder.items);
                sourceOrder.status = "finalizada"; // Effectively closing it
              }
            } else {
              sourceOrder.tableId = finalTargetTableId;
              targetTable.currentOrder = sourceOrder.id;
              targetTable.status = "occupied";
            }
          }
        }

        sourceTable.status = "linked";
        sourceTable.linkedTo = finalTargetTableId;
        sourceTable.currentOrder = targetTable.currentOrder;

        // Update all tables and comandas that were linked to source to now point to ultimateTarget
        const updateLinked = (t) => {
          if (t.linkedTo === sourceTable.id) {
            t.linkedTo = finalTargetTableId;
            t.currentOrder = targetTable.currentOrder;
          }
        };
        if (isComanda) {
          comandas.forEach(updateLinked);
        } else {
          tables.forEach(updateLinked);
        }

        io.emit("update_comandas", comandas);
        io.emit("update_tables", tables);
        io.emit("update_orders", orders);
      }
    });

    socket.on("transfer_table", ({ sourceTableId, targetTableId, isComanda, reason }) => {
      const targetList = isComanda ? comandas : tables;
      const sourceTable = targetList.find(t => t.id === sourceTableId);
      const targetTable = targetList.find(t => t.id === targetTableId);

      if (sourceTable && targetTable && sourceTable.currentOrder) {
        const sourceOrder = orders.find(o => o.id === sourceTable.currentOrder);
        const targetOrder = targetTable.currentOrder ? orders.find(o => o.id === targetTable.currentOrder) : null;

        if (sourceOrder) {
          if (targetOrder) {
            // Merge items
            sourceOrder.items.forEach(item => {
              targetOrder.items.push({
                ...item,
                id: Math.random().toString(36).substr(2, 9),
                transferReason: reason || "Troca de mesa"
              });
            });
            // Merge observations
            if (sourceOrder.observations) {
              targetOrder.observations = targetOrder.observations 
                ? `${targetOrder.observations} | ${sourceOrder.observations}`
                : sourceOrder.observations;
            }
            // Remove source order
            const sourceOrderIndex = orders.findIndex(o => o.id === sourceOrder.id);
            if (sourceOrderIndex !== -1) orders.splice(sourceOrderIndex, 1);
          } else {
            // Simple transfer
            sourceOrder.tableId = targetTableId;
            targetTable.currentOrder = sourceOrder.id;
            targetTable.status = sourceTable.status === "linked" ? "occupied" : sourceTable.status;
          }
          
          // Update any tables/comandas linked to the source table to point to the target table
          const updateLinked = (t) => {
            if (t.linkedTo === sourceTableId) {
              t.linkedTo = targetTableId;
              t.currentOrder = targetTable.currentOrder;
            }
          };
          if (isComanda) {
            comandas.forEach(updateLinked);
          } else {
            tables.forEach(updateLinked);
          }

          sourceTable.currentOrder = null;
          sourceTable.status = "free";
          sourceTable.linkedTo = null;
        }

        io.emit("update_comandas", comandas);
        io.emit("update_tables", tables);
        io.emit("update_orders", orders);
      }
    });

    socket.on("apply_discount", ({ orderId, itemId, discount, discountType }) => {
      const order = orders.find(o => o.id === orderId);
      if (order) {
        if (itemId) {
          const item = order.items.find(i => i.id === itemId);
          if (item) {
            item.discount = discount;
            item.discountType = discountType;
          }
        } else {
          order.discount = discount;
          order.discountType = discountType;
        }
        io.emit("update_orders", orders);
      }
    });

    socket.on("update_order_status", ({ orderId, status }) => {
      const order = orders.find(o => o.id === orderId);
      if (order) {
        order.status = status;
        io.emit("update_orders", orders);
      }
    });

    socket.on("request_bill", ({ tableId, isComanda }) => {
      const targetList = isComanda ? comandas : tables;
      const table = targetList.find(t => t.id === tableId);
      if (table) {
        table.status = "bill_requested";
        if (isComanda) {
          io.emit("update_comandas", comandas);
        } else {
          io.emit("update_tables", tables);
        }
      }
    });

    socket.on("close_table", ({ tableId, isComanda }) => {
      const targetList = isComanda ? comandas : tables;
      let table = targetList.find(t => t.id === tableId);
      
      if (table) {
        // Find the ultimate target table if this one is linked
        let ultimateTargetId = tableId;
        let current = table;
        const visited = new Set([current.id]);
        while (current.status === "linked" && current.linkedTo) {
          const next = targetList.find(t => t.id === current.linkedTo);
          if (!next || visited.has(next.id)) break;
          current = next;
          visited.add(current.id);
          ultimateTargetId = current.id;
        }

        const orderId = current.currentOrder;
        
        // Free the main table, the ultimate target, and all tables/comandas linked to that target or sharing the order
        const freeEntity = (t, targetId, orderId) => {
          if (
            t.id === targetId || 
            t.linkedTo === targetId || 
            (orderId && t.currentOrder === orderId)
          ) {
            t.status = "free";
            t.currentOrder = null;
            t.linkedTo = null;
          }
        };

        if (isComanda) {
          comandas.forEach(c => freeEntity(c, ultimateTargetId, orderId));
        } else {
          tables.forEach(t => freeEntity(t, ultimateTargetId, orderId));
        }

        // Also ensure the initial tableId is freed if it wasn't covered (though it should be)
        const initialTable = targetList.find(t => t.id === tableId);
        if (initialTable) {
          initialTable.status = "free";
          initialTable.currentOrder = null;
          initialTable.linkedTo = null;
        }

        if (orderId) {
          const order = orders.find(o => o.id === orderId);
          if (order) order.status = "finalizada";
        }

        io.emit("update_comandas", comandas);
        io.emit("update_tables", tables);
        io.emit("update_orders", orders);
      }
    });

    // Consolidated init_data is at the beginning of connection
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
