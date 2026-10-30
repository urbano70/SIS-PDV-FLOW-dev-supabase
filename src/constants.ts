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
    items: [],
    subcategories: [
      {
        id: 'sub-refrigerantes',
        name: 'Refrigerantes',
        items: [
          { id: 'b7',   name: 'COCA COLA 1L',               price: 12.00 },
          { id: 'b8',   name: 'COCA COLA KS',               price: 7.00  },
          { id: 'b9',   name: 'COCA COLA LATA',             price: 8.00  },
          { id: 'b10',  name: 'COCA COLA LATA ZERO',        price: 8.00  },
          { id: 'b11',  name: 'FANTA 1L',                   price: 12.00 },
          { id: 'b12',  name: 'FANTA LARANJA KS',           price: 7.00  },
          { id: 'b13',  name: 'FANTA LARANJA LATA',         price: 7.00  },
          { id: 'b14',  name: 'FANTA UVA LATA',             price: 7.00  },
          { id: 'b15',  name: 'GUARANA ANTARTICA LATA',     price: 7.00  },
          { id: 'b16',  name: 'H20 500ML',                  price: 10.00 },
          { id: 'b17',  name: 'SCHWEPPERS LATA',            price: 7.00  },
          { id: 'b18',  name: 'SPRITE LATA',                price: 7.00  },
          { id: 'b151', name: 'TORRE DE REFRIGERANTE 1,5 L',price: 18.00 },
        ]
      },
      {
        id: 'sub-cervejas',
        name: 'Cervejas',
        items: [
          { id: 'b19',  name: 'ARTARTICA ORIGINAL',  price: 18.00 },
          { id: 'b20',  name: 'BRAHMA',              price: 14.00 },
          { id: 'b160', name: 'BRAHMA ZERO LATA',    price: 7.00  },
          { id: 'b143', name: 'CDB',                 price: 3.00  },
          { id: 'b128', name: 'CORONA 600ML',        price: 22.00 },
          { id: 'b21',  name: 'HEINEKEN',            price: 22.00 },
          { id: 'b22',  name: 'SKOL',                price: 14.00 },
        ]
      },
      {
        id: 'sub-longneck',
        name: 'Cervejas Longneck',
        items: [
          { id: 'b89',  name: 'BUDWEISER',           price: 11.00 },
          { id: 'b126', name: 'BUDWEISER ZERO',      price: 11.00 },
          { id: 'b133', name: 'CORONA EXTRA LONG',   price: 12.00 },
          { id: 'b90',  name: 'HEINEKEN LONGNECK',   price: 12.00 },
          { id: 'b132', name: 'STELLA GOLD',         price: 12.00 },
        ]
      },
      {
        id: 'sub-chopp',
        name: 'Chopp',
        items: [
          { id: 'b24',  name: 'CANECA COZUMEL 340ML',          price: 12.00 },
          { id: 'b23',  name: 'CHOPP CANECA 340ML',            price: 10.00 },
          { id: 'b27',  name: 'CHOPP 1L',                      price: 30.00 },
          { id: 'b28',  name: 'CHOPP 1,5 L',                   price: 42.00 },
          { id: 'b29',  name: 'CHOPP 2,5 L',                   price: 80.00 },
          { id: 'b25',  name: 'TULIPINHA DE CHOPP 250ML',      price: 9.00  },
          { id: 'b26',  name: 'TULIPINHA DE CHOPP COZUMEL 250ML', price: 10.00 },
        ]
      },
      {
        id: 'sub-sucos',
        name: 'Sucos',
        items: [
          { id: 'b78',  name: 'COPO SUCO LARANJA',            price: 18.00 },
          { id: 'b79',  name: 'COPO SUCO MARACUJA',           price: 16.00 },
          { id: 'b80',  name: 'COPO SUCO ACEROLA',            price: 15.00 },
          { id: 'b81',  name: 'COPO SUCO ABACAXI',            price: 15.00 },
          { id: 'b82',  name: 'COPO SUCO ABACAXI COM HORTELA',price: 15.00 },
          { id: 'b83',  name: 'COPO SUCO MORANGO',            price: 15.00 },
          { id: 'b84',  name: 'COPO SUCO CUPUACU',            price: 16.00 },
          { id: 'b85',  name: 'SUCO KAPO',                    price: 7.00  },
          { id: 'b117', name: 'JARRA DE LARANJA',             price: 33.00 },
          { id: 'b118', name: 'JARRA MARACUJA',               price: 26.00 },
          { id: 'b119', name: 'JARRA ACEROLA',                price: 24.00 },
          { id: 'b120', name: 'JARRA ABACAXI',                price: 24.00 },
          { id: 'b121', name: 'JARRA ABACAXI C/ HORTELA',     price: 24.00 },
          { id: 'b122', name: 'JARRA MORANGO',                price: 24.00 },
          { id: 'b123', name: 'JARRA CUPUACU',                price: 26.00 },
        ]
      },
      {
        id: 'sub-aguas',
        name: 'Aguas',
        items: [
          { id: 'b86',  name: 'AGUA COM GAS',         price: 6.00  },
          { id: 'b87',  name: 'AGUA SEM GAS',         price: 5.00  },
          { id: 'b88',  name: 'AGUA TONICA',          price: 7.00  },
          { id: 'b140', name: 'EMBALAGEM PEQUENA',    price: 3.00  },
          { id: 'b141', name: 'EMBALAGEM GRANDE',     price: 5.00  },
          { id: 'b125', name: 'PLAY KIDS',            price: 12.00 },
          { id: 'b146', name: 'RODIZIO',              price: 65.00 },
          { id: 'b147', name: 'MEIO RODIZIO 5 A 10 ANOS', price: 31.00 },
        ]
      },
      {
        id: 'sub-doses',
        name: 'Doses Whisky',
        items: [
          { id: 'b108', name: 'DOSE OLD PARR',          price: 26.00 },
          { id: 'b109', name: 'DOSE CAMPARI',           price: 18.00 },
          { id: 'b110', name: 'DOSE BLACK LABEL',       price: 24.00 },
          { id: 'b111', name: 'DOSE RED LABEL',         price: 22.00 },
          { id: 'b112', name: 'DOSE JACK DANIELS',      price: 0.00  },
          { id: 'b113', name: 'RED BULL ENERGETICO',    price: 17.00 },
          { id: 'b158', name: 'DOSE DE VELHO BARREIRO', price: 8.00  },
          { id: 'b159', name: 'DOSE DE WODKA',          price: 12.00 },
        ]
      },
      {
        id: 'sub-vinhos',
        name: 'Vinhos',
        items: [
          { id: 'b114', name: 'PERGOLA TINTO SUAVE GARRAFA', price: 65.00 },
          { id: 'b115', name: 'PERGOLA TINTO SUAVE TACA',    price: 18.00 },
        ]
      },
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
  "SEM BORDA",
  "CATUPIRY",
  "CHEDDAR",
  "CHOCOLATE BRANCO",
  "CHOCOLATE PRETO",
];
