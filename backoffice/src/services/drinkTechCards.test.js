import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDrinkCard } from './drinkCards.js';

test('premium drinks match the current cashier names', () => {
  const card = matchDrinkCard('Напиток Кокосовый берег', 'Премиум Напитки');
  assert.equal(card.id, 'coconut-shore');
  assert.equal(card.serveIn, 'Смузийник 350');
  assert.equal(matchDrinkCard('Напиток Яблочная жвачка', 'Премиум Напитки').serveIn, 'Коктейльная рюмка');
  assert.equal(matchDrinkCard('Напиток Белый тоник', 'Премиум Напитки').serveIn, 'Бокал для вина');
});

test('beer cocktails match, lemonade and milkshake pina colada do not', () => {
  assert.equal(matchDrinkCard('Пина-Колада', 'Коктейли на пиве').id, 'pina-beer');
  assert.equal(matchDrinkCard('Ягодный Фреш', 'Коктейли на пиве').id, 'berry-beer');
  assert.equal(matchDrinkCard('Клубника-Бум', 'Коктейли на пиве').id, 'strawberry-beer');
  assert.equal(matchDrinkCard('Лимонад Пина-колада', 'Лимонады').id, 'rosa-pina');
  assert.equal(matchDrinkCard('Пина колада', 'Милкшейки'), null);
  assert.equal(matchDrinkCard('Пина-колада', 'Лимонады'), null);
  assert.equal(matchDrinkCard('Клубничная-жвачка', 'Лимонады'), null);
  assert.equal(matchDrinkCard('Напиток Клубничный рассвет', 'Премиум Напитки').id, 'strawberry-dawn');
});

test('sheet quantities stay on the matched card', () => {
  const mint = matchDrinkCard('Напиток Мятный лайм', 'Премиум Напитки');
  const sprite = mint.ingredients.find((row) => row.modifier === 'Спрайт');
  const mintLeaf = mint.ingredients.find((row) => row.modifier === 'Мята');
  assert.equal(sprite.qty, 80);
  assert.equal(mintLeaf.qty, 4);
  assert.equal(mint.serveIn, 'Хайболл 470');
});

test('rosa bar sheet maps onto cashier names and leaves other venues alone', () => {
  const mojito = matchDrinkCard('Лимонад Мохито (классический/клубничный)', 'Лимонады');
  assert.equal(mojito.id, 'rosa-strawberry-mojito');
  assert.equal(mojito.ingredients.find((row) => row.modifier === 'Спрайт').qty, 100);
  assert.equal(mojito.ingredients.find((row) => row.modifier === 'Лёд').qty, 0);
  assert.match(mojito.ingredients.at(-1).modifier, /^Способ: 1\. В стакан/);
  assert.equal(matchDrinkCard('Мохито', 'Лимонады'), null);
  assert.equal(matchDrinkCard('Клубничный мохито', 'Лимонады'), null);

  const lagoon = matchDrinkCard('Лимонад Голубая лагуна', 'Лимонады');
  assert.equal(lagoon.id, 'rosa-blue-lagoon');
  assert.equal(lagoon.ingredients.find((row) => row.modifier === 'Спрайт').qty, 160);
  assert.equal(lagoon.serveIn, 'Хайболл 470');
  assert.equal(matchDrinkCard('Голубая лагуна', 'Лимонады'), null);

  const pina = matchDrinkCard('Лимонад Пина-колада', 'Лимонады');
  assert.equal(pina.ingredients.find((row) => row.modifier === 'Лимонный сок').qty, 10);
  assert.match(pina.ingredients.at(-1).modifier, /^Способ: 1\. Поместить/);

  assert.equal(matchDrinkCard('Лимонад Цитрус-гранат', 'Лимонады').id, 'rosa-citrus-pomegranate');
  assert.equal(matchDrinkCard('Цитрус-гранат', 'Лимонады'), null);
  assert.equal(matchDrinkCard('Лимонад Лесные ягоды', 'Лимонады').ingredients.find((row) => row.modifier === 'Малиновый сироп').qty, 15);
  assert.equal(matchDrinkCard('Лимонад Ананас-ежевика', 'Лимонады').id, 'rosa-pineapple-blackberry');
  assert.equal(matchDrinkCard('Лимонад Цитрусовый раш', 'Лимонады на энергетиках').id, 'rosa-citrus-rush');
  assert.equal(matchDrinkCard('Лимонад Вишневый раш', 'Лимонады на энергетиках'), null);
  assert.equal(matchDrinkCard('Лимонад Зеленый Раш', 'Лимонады').id, 'rosa-green-rush');
  const grape = matchDrinkCard('Лимонад Виноградный раш', 'Лимонады на энергетиках');
  assert.equal(grape.id, 'rosa-grape-rush');
  assert.equal(grape.ingredients.find((row) => row.modifier === 'Мята').qty, 0);

  const buckthorn = matchDrinkCard('Чай авторский - Облепиховый', 'Авторский чай');
  assert.equal(buckthorn.id, 'rosa-sea-buckthorn-tea');
  assert.equal(buckthorn.serveIn, 'Чайник');
  assert.equal(buckthorn.ingredients.find((row) => row.modifier === 'Облепиховое пюре').qty, 170);
  assert.equal(buckthorn.ingredients.find((row) => row.modifier === 'Облепиховое пюре').unit, 'g');
  assert.match(buckthorn.ingredients.at(-1).modifier, /^Способ: залить все/);
  assert.equal(matchDrinkCard('Облепиховый', 'На пюре'), null);
  assert.equal(matchDrinkCard('Облепиховый с имбирем', 'Авторский чай'), null);

  const mandarin = matchDrinkCard('Чай авторский - Малина мандарин', 'Авторский чай');
  assert.equal(mandarin.id, 'rosa-raspberry-mandarin-tea');
  assert.equal(mandarin.ingredients.find((row) => row.modifier === 'Малиновое пюре').qty, 160);
  assert.equal(mandarin.ingredients.find((row) => row.modifier === 'Мандарин').qty, 100);
  assert.equal(matchDrinkCard('Малина мандарин', 'На пюре'), null);

  for (const card of [mojito, pina, buckthorn, mandarin]) {
    for (const row of card.ingredients) {
      assert.ok(row.modifier.length <= 300, row.modifier);
    }
  }
});
