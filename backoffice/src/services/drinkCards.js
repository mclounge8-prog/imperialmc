// Техкарта напитков MC Lounge Роза. Названия позиций — как в кассе.
// Бокал не модификатор: его нельзя снять галочкой, он пишется в menu_items.serve_in.
// Ингредиенты — модификаторы состава. Количество с техкарты, единица берётся
// со склада (мл / г / шт), поэтому «50 гр» водки в таблице становится 50 мл.

export const DRINK_TECH_CARD_VERSION = 2;

function ingredient(modifier, qty, warehouseName, extra = {}) {
  return {
    modifier,
    qty,
    warehouseName: warehouseName === undefined ? modifier : warehouseName,
    unit: extra.unit || null,
    warehouseCategory: extra.warehouseCategory || null,
  };
}

function preparation(text) {
  return ingredient(`Способ: ${text}`, 0, null);
}

// В этой таблице у льда, лимона и мяты нет граммов. Строка остаётся в составе,
// со склада не списывается.
const UNSCORED_ICE = ingredient('Лёд', 0, 'Лёд');
const UNSCORED_LEMON = ingredient('Лимон', 0, 'Лимон');
const TEA = { unit: 'g', warehouseCategory: 'Чай' };

// В таблице лёд без граммовки. В кассе порция уже была 120 г — так и списываем,
// чтобы пустой дубль модификатора не обнулил списание.
const ICE = ingredient('Лёд', 120, 'Лёд');

export const DRINK_CARDS = [
  {
    id: 'orange-screw',
    group: 'premium',
    keys: ['апельсиновый винт'],
    serveIn: 'Рокс',
    ingredients: [
      ingredient('Апельсиновый сок', 100),
      ingredient('Водка', 50),
      ICE,
    ],
  },
  {
    id: 'amber-cola',
    group: 'premium',
    keys: ['янтарная кола'],
    serveIn: 'Рокс',
    ingredients: [ingredient('Кола', 100), ingredient('Виски', 50), ICE],
  },
  {
    id: 'mint-lime',
    group: 'premium',
    keys: ['мятный лайм'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Газированная вода', 100),
      ingredient('Спрайт', 80),
      ingredient('Сахарный сироп', 10),
      ingredient('Ром белый', 50, 'Ром белый'),
      ingredient('Лайм', 30),
      ingredient('Мята', 4),
      ICE,
    ],
  },
  {
    id: 'coconut-shore',
    group: 'premium',
    keys: ['кокосовый берег'],
    serveIn: 'Смузийник 350',
    ingredients: [
      ingredient('Молоко', 100),
      ingredient('Ананасовый сок', 100),
      ingredient('Кокосовый сироп', 30),
      ingredient('Ром белый', 50, 'Ром белый'),
      ICE,
    ],
  },
  {
    id: 'blue-bay',
    group: 'premium',
    keys: ['голубая бухта'],
    serveIn: 'Смузийник 350',
    ingredients: [
      ingredient('Спрайт', 150),
      ingredient('Водка', 50),
      ingredient('Лимонный сок', 15, 'Лимонный сок'),
      ingredient('Блю кюрасао сироп', 25),
      ICE,
    ],
  },
  {
    id: 'cranberry-city',
    group: 'premium',
    keys: ['клюквенный город'],
    serveIn: 'Коктейльная рюмка',
    ingredients: [
      ingredient('Клюквенный сок', 60),
      ingredient('Водка', 40),
      ingredient('Лимонный сок', 10, 'Лимонный сок'),
      ICE,
    ],
  },
  {
    id: 'apple-gum',
    group: 'premium',
    keys: ['яблочная жвачка'],
    serveIn: 'Коктейльная рюмка',
    ingredients: [
      ingredient('Яблочный сок', 50),
      ingredient('Ром белый', 30, 'Ром белый'),
      ingredient('Лимонный сок', 15, 'Лимонный сок'),
      ingredient('Сироп бабл-гам', 20),
      ICE,
    ],
  },
  {
    id: 'strawberry-dawn',
    group: 'premium',
    keys: ['клубничный рассвет'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Апельсиновый сок', 150),
      ingredient('Текила', 50),
      ingredient('Клубничный сироп', 15),
      ICE,
    ],
  },
  {
    id: 'juniper-tonic',
    group: 'premium',
    keys: ['можжевеловый тоник'],
    serveIn: 'Рокс',
    ingredients: [
      ingredient('Джин сухой', 50),
      ingredient('Тоник', 150),
      ingredient('Лимонный сок', 5, 'Лимонный сок'),
      ICE,
    ],
  },
  {
    id: 'pomegranate-fire',
    group: 'premium',
    keys: ['гранатовый огонь'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Martini Fiero', 50, 'Martini Fiero'),
      ingredient('Гранатовый сок', 100),
      ingredient('Тоник', 50),
      ingredient('Зёрна граната', null, null),
      ICE,
    ],
  },
  {
    id: 'white-tonic',
    group: 'premium',
    keys: ['белый тоник'],
    serveIn: 'Бокал для вина',
    ingredients: [
      ingredient('Martini Bianco', 50, 'Martini Bianco'),
      ingredient('Тоник', 100),
      ingredient('Лимон', 1, 'Лимон'),
      ICE,
    ],
  },
  {
    id: 'long-mix',
    group: 'premium',
    keys: ['длинный микс'],
    serveIn: 'Смузийник 350',
    ingredients: [
      ingredient('Водка', 15),
      ingredient('Ром белый', 15, 'Ром белый'),
      ingredient('Текила', 15),
      ingredient('Джин сухой', 15),
      ingredient('Кола', 100),
      ingredient('Лимонный сок', 10, 'Лимонный сок'),
      ingredient('Сахарный сироп', 10),
      ICE,
    ],
  },
  {
    id: 'berry-beer',
    group: 'beer',
    keys: ['ягодный фреш', 'ягодное пиво'],
    serveIn: null,
    ingredients: [
      ingredient('Темное пиво', 250),
      ingredient('Вишнёвый сок', 150),
      ingredient('Гранатовый сок', 40),
      ingredient('Вишнёвый сироп', 30),
    ],
  },
  {
    id: 'strawberry-beer',
    group: 'beer',
    keys: ['клубника бум', 'клубничное пиво'],
    serveIn: null,
    ingredients: [
      ingredient('Светлое пиво', 200),
      ingredient('Апельсиновый сок', 200),
      ingredient('Клубничный сироп', 40),
      ingredient('Блю кюрасао сироп', 40),
      ingredient('Лимонный сок', 10, 'Лимонный сок'),
    ],
  },
  {
    id: 'pina-beer',
    group: 'beer',
    keys: ['пина колада'],
    serveIn: null,
    ingredients: [
      ingredient('Светлое пиво', 300),
      ingredient('Ананасовый сок', 100),
      ingredient('Кокосовый сироп', 45),
    ],
  },
  {
    id: 'rosa-strawberry-mojito',
    group: 'rosa',
    keys: ['лимонад мохито'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Газированная вода', 100),
      ingredient('Спрайт', 100),
      ingredient('Сахарный сироп', 10),
      ingredient('Клубничный сироп', 25),
      ingredient('Лайм', 30),
      ingredient('Мята', 4),
      UNSCORED_ICE,
      preparation(
        '1. В стакан добавить лайм, мяту и сахар. сироп, размять мадлером. 2. Добавить лед, затем все остальные ингредиенты. 3. Размешать барной ложкой.'
      ),
    ],
  },
  {
    id: 'rosa-blue-lagoon',
    group: 'rosa',
    keys: ['лимонад голубая лагуна'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Спрайт', 160),
      ingredient('Газированная вода', 80),
      ingredient('Лимонный сок', 10),
      ingredient('Блю кюрасао сироп', 30),
      UNSCORED_LEMON,
      UNSCORED_ICE,
    ],
  },
  {
    id: 'rosa-pina',
    group: 'rosa',
    keys: ['лимонад пина-колада'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Молоко', 130),
      ingredient('Ананасовый сок', 130),
      ingredient('Кокосовый сироп', 30),
      ingredient('Лимонный сок', 10),
      UNSCORED_ICE,
      preparation(
        '1. Поместить все ингридиенты в шейкер со льдом. 2. Взболтать и перелить через фильтр.'
      ),
    ],
  },
  {
    id: 'rosa-citrus-pomegranate',
    group: 'rosa',
    keys: ['лимонад цитрус-гранат'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Апельсиновый сок', 80),
      ingredient('Спрайт', 150),
      ingredient('Гренадин', 25),
      ingredient('Лимонный сок', 10),
      UNSCORED_LEMON,
      UNSCORED_ICE,
    ],
  },
  {
    id: 'rosa-forest-berries',
    group: 'rosa',
    keys: ['лимонад лесные ягоды'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Спрайт', 150),
      ingredient('Клюквенный сок', 80),
      ingredient('Лимонный сок', 10),
      ingredient('Малиновый сироп', 15),
      ingredient('Клубничный сироп', 10),
      UNSCORED_ICE,
    ],
  },
  {
    id: 'rosa-pineapple-blackberry',
    group: 'rosa',
    keys: ['лимонад ананас-ежевика', 'лимонад ананас ежевика'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Ананасовый сок', 80),
      ingredient('Спрайт', 150),
      ingredient('Ежевичный сироп', 25),
      ingredient('Лимонный сок', 10),
      UNSCORED_ICE,
    ],
  },
  {
    id: 'rosa-citrus-rush',
    group: 'rosa',
    keys: ['цитрусовый раш'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Энергетик', 150),
      ingredient('Апельсиновый сок', 80),
      ingredient('Лимонный сок', 15),
      UNSCORED_ICE,
    ],
  },
  {
    id: 'rosa-green-rush',
    group: 'rosa',
    keys: ['зеленый раш'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Энергетик', 150),
      ingredient('Апельсиновый сок', 80),
      ingredient('Лимонный сок', 15),
      ingredient('Блю кюрасао сироп', 15),
      UNSCORED_ICE,
    ],
  },
  {
    id: 'rosa-grape-rush',
    group: 'rosa',
    keys: ['виноградный раш'],
    serveIn: 'Хайболл 470',
    ingredients: [
      ingredient('Энергетик', 150),
      ingredient('Виноградный сок', 80),
      ingredient('Ежевичный сироп', 15),
      ingredient('Мята', 0),
      UNSCORED_ICE,
    ],
  },
  {
    id: 'rosa-sea-buckthorn-tea',
    group: 'rosa',
    keys: ['чай авторский облепиховый'],
    serveIn: 'Чайник',
    ingredients: [
      ingredient('Облепиховое пюре', 170, 'Облепиховое пюре', TEA),
      ingredient('Сахарный сироп', 40),
      preparation('залить все кипятком в чайник и размешать'),
    ],
  },
  {
    id: 'rosa-raspberry-mandarin-tea',
    group: 'rosa',
    keys: ['чай авторский малина мандарин'],
    serveIn: 'Чайник',
    ingredients: [
      ingredient('Малиновое пюре', 160, 'Малиновое пюре', TEA),
      ingredient('Мандарин', 100, 'Мандарин', TEA),
      preparation('залить пюре и мандарины в чайник, размять мадлером и залить кипятком'),
    ],
  },
];

export function normalizeDrinkLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesKey(name, key) {
  return name.includes(normalizeDrinkLabel(key));
}

function isLemonade(name, category) {
  return category.includes('лимонад') || name.includes('лимонад');
}

function isBeerContext(category) {
  return category.includes('пив');
}

// Какая карточка техкарты подходит позиции. Лимонад и милкшейк «пина-колада»
// не получают пивной рецепт: для него нужна категория с «пив».
export function matchDrinkCard(itemName, categoryName) {
  const name = normalizeDrinkLabel(itemName);
  const category = normalizeDrinkLabel(categoryName);
  for (const card of DRINK_CARDS) {
    if (card.group !== 'rosa') continue;
    if (card.keys.some((key) => includesKey(name, key))) return card;
  }
  for (const card of DRINK_CARDS) {
    if (card.group !== 'premium') continue;
    if (card.keys.some((key) => includesKey(name, key))) return card;
  }
  for (const card of DRINK_CARDS) {
    if (card.group !== 'beer') continue;
    if (!card.keys.some((key) => includesKey(name, key))) continue;
    if (card.id === 'pina-beer') {
      if (isLemonade(name, category) || !isBeerContext(category)) continue;
    }
    return card;
  }
  return null;
}
