export const MENU_CATEGORIES = [
  {
    name: 'Pizzas',
    type: 'pizzas',
    items: [],
    subcategories: [
      {
        id: 'com-borda',
        name: 'Com Borda',
        position: 0,
        visible: true,
        items: [
          { id: 'pcb1', name: 'Mini com Borda',       price: 58.00,  ingredients: '4 fatias · 20cm · 1 sabor' },
          { id: 'pcb2', name: 'Pequena com Borda',    price: 70.00,  ingredients: '4 fatias · 25cm · até 2 sabores' },
          { id: 'pcb3', name: 'Média com Borda',      price: 89.00,  ingredients: '6 fatias · 30cm · até 2 sabores' },
          { id: 'pcb4', name: 'Grande com Borda',     price: 105.00, ingredients: '8 fatias · 35cm · até 4 sabores' },
          { id: 'pcb5', name: 'GG com Borda',         price: 89.00,  ingredients: '12 fatias · 40cm · até 4 sabores' },
          { id: 'pcb6', name: 'Meio Metro com Borda', price: 145.00, ingredients: '16 fatias · 50x25cm · até 4 sabores' },
          { id: 'pcb7', name: 'Metro com Borda',      price: 38.00,  ingredients: '24 fatias · 100x25cm · até 6 sabores' },
        ]
      },
      {
        id: 'sem-borda',
        name: 'Sem Borda',
        position: 1,
        visible: true,
        items: [
          { id: 'psb1', name: 'Mini sem Borda',       price: 45.00,  ingredients: '4 fatias · 20cm · 1 sabor' },
          { id: 'psb2', name: 'Pequena sem Borda',    price: 65.00,  ingredients: '4 fatias · 25cm · até 2 sabores' },
          { id: 'psb3', name: 'Média sem Borda',      price: 80.00,  ingredients: '6 fatias · 30cm · até 2 sabores' },
          { id: 'psb4', name: 'Grande sem Borda',     price: 95.00,  ingredients: '8 fatias · 35cm · até 4 sabores' },
          { id: 'psb5', name: 'GG sem Borda',         price: 89.00,  ingredients: '12 fatias · 40cm · até 4 sabores' },
          { id: 'psb6', name: 'Meio Metro sem Borda', price: 145.00, ingredients: '16 fatias · 50x25cm · até 4 sabores' },
          { id: 'psb7', name: 'Metro sem Borda',      price: 38.00,  ingredients: '24 fatias · 100x25cm · até 6 sabores' },
        ]
      }
    ]
  },
  {
    name: 'Lanches',
    type: 'lanches',
    items: [
      { id: 'l1', name: 'X DELLI SALADA', price: 32.00, ingredients: 'Hambúrguer artesanal, alface, tomate, presunto, mussarela, milho verde, ervilha e molho Delli.' },
      { id: 'l2', name: 'X DELLI BACON', price: 40.00, ingredients: 'Hambúrguer artesanal, bacon, alface, tomate, mussarela, ovo, milho verde, ervilha e molho Delli.' },
      { id: 'l3', name: 'X DELLI BURGUER', price: 15.00, ingredients: 'Hambúrguer, tomate, ovo, mussarela, presunto e molho Delli.' },
    ]
  },
  {
    name: 'Bebidas',
    type: 'bebidas',
    items: [
      { id: 'b1', name: 'COCA COLA LATA', price: 14.00, ingredients: 'Lata' },
      { id: 'b2', name: 'FANTA LARANJA LATA', price: 10.00, ingredients: 'Lata' },
      { id: 'b3', name: 'GUARANÁ ANTARCTICA LATA', price: 6.00, ingredients: 'Lata' },
    ]
  }
];

export const PIZZA_FLAVORS = [
  { name: 'CALABRESA AO CREME', ingredients: 'Mussarela, molho de tomate, calabresa, creme de leite, orégano e azeitona.' },
  { name: 'CALABRESA COM CEBOLA', ingredients: 'Mussarela, molho de tomate, calabresa, cebola, orégano e azeitona.' },
  { name: 'CALABRESA', ingredients: 'Mussarela, molho de tomate, calabresa, orégano e azeitona.' },
  { name: 'QUATRO QUEIJOS', ingredients: 'Mussarela, molho de tomate, parmesão, provolone e catupiry.' },
  { name: 'BAIANA', ingredients: 'Mussarela, molho de tomate, calabresa, pimenta calabresa, orégano e azeitona.' },
  { name: 'STROGONOFF', ingredients: 'Mussarela, molho de alho, carne bovina, creme de leite, orégano e azeitona.' },
  { name: 'PICANHA AO CREME', ingredients: 'Mussarela, molho de alho, carne bovina, creme de leite, orégano e azeitona.' },
  { name: 'PICANHA COM CATUPIRY', ingredients: 'Mussarela, molho de tomate, carne bovina, catupiry, orégano e azeitona.' },
  { name: 'PICANHA', ingredients: 'Mussarela, molho de alho, carne bovina, cebola, orégano e azeitona.' },
  { name: 'CHOCOLATE', ingredients: 'Mussarela, chocolate ao leite, cereja e leite condensado.' },
  { name: 'PRESTIGIO', ingredients: 'Mussarela, chocolate ao leite, coco ralado, leite condensado.' },
  { name: 'CONFETE', ingredients: 'Mussarela, chocolate ao leite, confete, e leite condensado.' },
  { name: 'CHOCOLATE COM MORANGO', ingredients: 'Mussarela, chocolate ao leite, morango e leite condensado.' },
  { name: 'CHOCOLATE BRANCO', ingredients: 'Mussarela, chocolate branco, cereja e leite condensado.' },
  { name: 'BRIGADEIRO', ingredients: 'Mussarela, chocolate ao leite, granulado e leite condensado.' },
  { name: 'MARGUERITA', ingredients: 'Mussarela, molho de tomate, manjericão, tomate, orégano e azeitona.' },
  { name: 'BACON', ingredients: 'Mussarela, molho de tomate, bacon, orégano e azeitona.' },
  { name: 'RÚCULA COM TOMATE SECO', ingredients: 'Mussarela, molho de tomate, rúcula, tomate seco, orégano e azeitona.' },
  { name: 'ATUM COM CEBOLA', ingredients: 'Mussarela, molho de tomate, atum, cebola, orégano e azeitona.' },
  { name: 'MODA DA DELLI', ingredients: 'Mussarela, molho de tomate, ovo, milho, ervilha, cebola, bacon, tomate, orégano e azeitona.' },
  { name: 'PALMITO', ingredients: 'Mussarela, molho de tomate, palmito, orégano e azeitona.' },
  { name: 'BRÓCOLIS COM ALHO', ingredients: 'Mussarela, molho de tomate, brócolis, alho frito, orégano e azeitona.' },
  { name: 'BRÓCOLIS COM BACON', ingredients: 'Mussarela, molho de tomate, brócolis, bacon, orégano e azeitona.' },
  { name: 'BACON COM MILHO', ingredients: 'Mussarela, molho de tomate, bacon, milho, orégano e azeitona.' },
  { name: 'LOMBO', ingredients: 'Mussarela, molho de tomate, lombo canadense, orégano e azeitona.' },
  { name: 'LOMBO AO CREME', ingredients: 'Mussarela, molho de tomate, lombo canadense, creme de leite, orégano e azeitona.' },
  { name: 'CARNE DE SOL', ingredients: 'Mussarela, molho de tomate, carne desfiada, bacon, cebola, orégano e azeitona.' },
  { name: 'BEJINHO', ingredients: 'Mussarela, coco ralado,chocolate branco, e leite condensado.' },
  { name: 'PORTUGUESA', ingredients: 'Mussarela, molho de tomate, milho verde, ervilha, calabresa ralada, lombo ralado, ovo, orégano e azeitona.' },
  { name: 'ROMEU E JULIETA', ingredients: 'Mussarela, Goiabada, Creme de leite' },
];

export const PIZZA_CRUSTS = [
  "BORDA DE CHOCOLATE",
  "BRANCO",
  "CHEDDAR",
  "CATUPIRY"
];
