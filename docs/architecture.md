# d2r-saver — Architecture

Полная документация по внутреннему устройству библиотеки.

## Содержание

- [Обзор](#обзор)
- [Структура каталогов](#структура-каталогов)
- [D2RSaver — главный фасад](#d2rsaver--главный-фасад)
- [Бинарный формат](#бинарный-формат)
  - [BinaryReader](#binaryreader)
  - [Huffman-кодирование](#huffman-кодирование)
- [Форматы файлов](#форматы-файлов)
  - [Определение формата](#определение-формата)
  - [D2S — файл персонажа](#d2s--файл-персонажа)
  - [D2I — общий сундук](#d2i--общий-сундук)
- [Парсинг предметов](#парсинг-предметов)
  - [createItemParser](#createitemparser)
  - [BinaryParsedItem](#binaryparseditem)
  - [Алгоритм чтения предмета](#алгоритм-чтения-предмета)
  - [Система статов](#система-статов)
- [Запись предметов](#запись-предметов)
- [GameData — регистр игровых данных](#gamedata--регистр-игровых-данных)
  - [Загрузка](#загрузка)
  - [processData — 14 шагов обработки](#processdata--14-шагов-обработки)
  - [Типы данных](#типы-данных)
  - [Производные поля](#производные-поля)
- [Система предметов](#система-предметов)
  - [Сериализация токенов](#сериализация-токенов)
  - [Иконки](#иконки)
  - [Trade DTO](#trade-dto)
- [Операции](#операции)
  - [Extract (извлечение)](#extract-извлечение)
  - [Insert (вставка)](#insert-вставка)
  - [readSave](#readsave)
- [Инвентарная сетка](#инвентарная-сетка)
- [Обработка ошибок](#обработка-ошибок)
- [Data Pipeline](#data-pipeline)
  - [Исходные файлы](#исходные-файлы)
  - [Парсеры](#парсеры)
  - [Оркестратор](#оркестратор)
  - [Merge](#merge)
  - [Строковые ресурсы](#строковые-ресурсы)
- [Тестирование](#тестирование)

---

## Обзор

**d2r-saver** — TypeScript-библиотека для чтения и записи save-файлов Blizzless D2R версии 105.

Основные возможности:
- Чтение `.d2s` (персонаж) и `.d2i` (общий сундук)
- Извлечение предметов из сейвов
- Вставка предметов в сейвы
- Сериализация предметов в портативные токены (`d2r1:<base64>`) для передачи между игроками
- Определение иконок для отображения
- Конвертация в Trade DTO для бэкенда

**Ограничения:**
- Только Blizzless v105 — никакой поддержки других версий/модов
- Только серверная (Node.js ≥ 18) — нет браузерного кода

**Происхождение:** Портирована из `d2planner` (JS), упрощена: убраны все ветки версий, UI-код, глобальные синглтоны. GameData вместо глобального `Data`, передаётся явно.

---

## Структура каталогов

```
d2r-saver/
├── src/
│   ├── index.ts                — D2RSaver фасадный класс + ре-экспорты
│   ├── core/                   — Низкоуровневый бинарный I/O
│   │   ├── binary-reader.ts    — BinaryReader (побитовое чтение)
│   │   ├── binary-writer.ts    — BitWriter (побитовая запись)
│   │   ├── checksum.ts         — Расчёт/патч контрольной суммы D2S
│   │   └── huffman.ts          — Дерево Хаффмана для кодов предметов
│   ├── types/                  — Константы, перечисления, ошибки
│   │   ├── constants.ts        — ItemQuality, LocationType, StorageType, магические числа
│   │   ├── errors.ts           — D2RSaverError, ErrorCode
│   │   ├── item.ts             — Общие типы предметов
│   │   ├── save-file.ts        — Типы для save-файлов
│   │   └── trade-item.ts       — Типы для торгового DTO
│   ├── game-data/              — Загрузка и обработка игровых таблиц
│   │   ├── game-data.ts        — GameData класс (центральный регистр)
│   │   ├── types.ts            — 25+ интерфейсов для таблиц данных
│   │   └── loader.ts           — Загрузка data.json / strings.json из файловой системы
│   ├── formats/                — Чтение/запись бинарных форматов
│   │   ├── detect.ts           — Определение формата (.d2s / .d2i)
│   │   ├── d2s-reader.ts       — Чтение .d2s (персонаж)
│   │   ├── d2s-writer.ts       — Запись .d2s
│   │   ├── d2i-reader.ts       — Чтение .d2i (сундук)
│   │   ├── d2i-writer.ts       — Запись .d2i
│   │   ├── item-parser.ts      — Парсер предметов из бинарного формата
│   │   └── item-writer.ts      — Запись предметов в бинарный формат
│   ├── items/                  — Логика работы с предметами
│   │   ├── item-serializer.ts  — Токены сериализации (d2r1:)
│   │   ├── item-icon.ts        — Разрешение HD/SD иконок
│   │   ├── item-dto.ts         — Конвертация в TradeItemDTO
│   │   ├── item-stats-parser.ts— Разбор мод-статов (unique/set/runeword/magic)
│   │   ├── item-types.ts       — isSubType, itemGetTypes, presetItemIds
│   │   └── item.ts             — Утилиты для предметов
│   ├── operations/             — Высокоуровневые операции
│   │   ├── extract-item.ts     — Извлечение предмета из сейва
│   │   ├── insert-item.ts      — Вставка предмета в сейв
│   │   └── read-save.ts        — Универсальное чтение (авто-детект)
│   ├── inventory/              — Инвентарная сетка и размещение
│   │   ├── grid.ts             — StashGrid (Float64Array сетка занятости)
│   │   ├── placement.ts        — canPlaceItem, findFreeSlot, buildGrid
│   │   └── dimensions.ts       — GridSize, STASH/INVENTORY/CUBE размеры
│   └── data-parser/            — Пайплайн генерации данных
│       ├── index.ts            — Точка входа (npm run build:data)
│       ├── generate-all.ts     — Оркестратор (4 фазы)
│       ├── merge-json.ts       — Слияние JSON → data.json
│       ├── strings.ts          — Генерация strings.json
│       ├── files.ts            — I/O утилиты (readGameFile, writeJson)
│       ├── to-number.ts        — Конвертация строк TSV в числа
│       ├── get-hd.ts           — Маппинг HD-иконок
│       ├── get-skill-id.ts     — Маппинг навыков по имени → ID
│       └── parsers/            — 36 парсеров таблиц
├── data/
│   ├── txt/                    — Исходные TSV таблицы из игры
│   │   └── strings/            — JSON-файлы локализации
│   ├── json/                   — Промежуточные JSON (генерируются)
│   ├── data.json               — Объединённые данные (генерируется)
│   └── strings.json            — Строковые ресурсы (генерируется)
└── tests/                      — 302 Vitest-теста
```

---

## D2RSaver — главный фасад

Файл: `src/index.ts` (259 строк).

`D2RSaver` — единственная точка входа для потребителей библиотеки. Класс инкапсулирует `GameData` и делегирует вызовы внутренним модулям.

### Создание инстанса

```ts
// Из файлов:
const saver = await D2RSaver.create({
  dataPath: './data/data.json',
  stringsPath: './data/strings.json',
});

// Из готовых JSON-объектов:
const saver = D2RSaver.fromData(rawData, locale);
```

Конструктор `private` — экземпляры создаются только через фабричные методы.

### Методы

| Метод | Описание |
|---|---|
| `detectFormat(buffer)` | Определение формата файла (d2s / d2i) |
| `readD2S(buffer)` | Чтение .d2s персонажа |
| `readD2I(buffer)` | Чтение .d2i сундука |
| `readSave(buffer)` | Авто-детект + чтение |
| `extractItemD2S(buffer, itemId)` | Извлечь предмет из персонажа |
| `extractItemD2I(buffer, page, x, y)` | Извлечь предмет из сундука |
| `insertItemD2S(buffer, item, allItems, target, pos?)` | Вставить предмет в персонажа |
| `insertItemD2I(buffer, item, allItems, target?)` | Вставить предмет в сундук |
| `serializeItem(item, allItems)` | Предмет → токен `d2r1:<base64>` |
| `deserializeItem(token)` | Токен → предмет |
| `getItemIconPath(item)` | HD иконка |
| `getItemIconSD(item)` | SD иконка (invfile) |
| `toTradeDTO(item, allItems)` | Предмет → TradeItemDTO |
| `canPlaceItem(grid, x, y, item)` | Проверка размещения |
| `findFreeSlot(grid, item)` | Поиск свободного места |
| `findFreeSlotInStash(grids, item)` | Поиск через несколько страниц |
| `getItemSize(item)` | Размер предмета в ячейках |

### Ре-экспорты

Все ключевые типы и интерфейсы ре-экспортируются из `src/index.ts`:
- `GameData`, `D2RSaverError`, `ErrorCode`, `StashGrid`
- Типы: `DetectedFormat`, `D2SReadResult`, `D2IReadResult`, `BinaryParsedItem`, `ExtractResult`, `InsertResult`, `TradeItemDTO`, `PlacementItem` и т.д.

---

## Бинарный формат

### BinaryReader

Файл: `src/core/binary-reader.ts` (151 строка).

Побитовый/побайтовый ридер для D2R save файлов. Основной механизм парсинга.

**Принцип:** `bitpos` — текущая позиция в битах. Все чтения сдвигают `bitpos`.

| Метод | Описание |
|---|---|
| `read8() / read16() / read32()` | Байтово-выравненное чтение (little-endian) |
| `bits(count)` | Чтение произвольного количества бит (LE) |
| `bit()` | Одиночный бит (0 или 1) |
| `char()` | Huffman-декодированный символ |
| `string(len) / utf8(len)` | Фиксированные строки |
| `seek(pos) / skip(bytes)` | Навигация (байтовая) |
| `skipbits(count)` | Навигация (битовая) |
| `align()` | Выравнивание до границы байта |

**Чтение бит (LE):** Каждый бит читается из текущего байта начиная с младшего разряда:

```
byte[bitpos >> 3]  →  бит (bitpos & 7)
```

При чтении N бит, биты накапливаются сдвигом влево.

### Huffman-кодирование

Файл: `src/core/huffman.ts`.

Коды предметов (3-символьные, например `cap`, `rin`, `amf`) в v105 D2R хранятся в Huffman-кодировке. Дерево `HUFFMAN_TREE` — статический бинарный массив. `BinaryReader.char()` спускается по дереву, читая по одному биту, пока не дойдёт до листа (символа).

Каждый предмет кодируется 4 символами: 3 буквы + пробел (`' '`).

---

## Форматы файлов

### Определение формата

Файл: `src/formats/detect.ts` (55 строк).

```ts
function detectFormat(data: Uint8Array): DetectedFormat | null
```

Проверяет:
1. Magic signature `0xAA55AA55` по смещению 0
2. Версию D2S по смещению 4 (должна быть 105)
3. Или версию D2I по смещению 8 (должна быть 105)

Возвращает `{ type: 'd2s' | 'd2i', version: 105 }` или `null`.

### D2S — файл персонажа

Файл: `src/formats/d2s-reader.ts` (221 строка).

**Формат D2S v105:**

| Смещение | Размер | Описание |
|---|---|---|
| 0 | 4 | Magic: `0xAA55AA55` |
| 4 | 4 | Версия: `105` |
| 16 | 4 | 4 нулевых байта |
| 24 | 1 | Класс персонажа (0-6) |
| 163 | 4+6+4 | Наёмник: ID, имя, тип, опыт |
| 299 | 16 | Имя персонажа (UTF-8) |
| 413 | 96×3 | Квесты (Normal / Nightmare / Hell) |
| 833 | ... | Статы персонажа (маркер `0x6667` "gf") |
| после статов | 30 | Навыки (маркер `0x6669` "fi") |
| после навыков | ... | Предметы (маркер `0x4D4A` "JM") |

**Парсинг статов:** 9-битный ID стата + `csvbits` бит значения, цикл до ID=511 (терминатор).

**Результат `readD2S()`:**

```ts
interface D2SReadResult {
  profile: D2SCharacterProfile;  // Имя, класс, уровень, статы, навыки, квесты
  items: Record<number, BinaryParsedItem>;  // Все предметы
  warnings: string[];
}
```

`D2SCharacterProfile` содержит:
- `name`, `class`, `level`, `stats` (str/dex/int/vit — поверх базовых)
- `skills` — `Record<skillId, level>`
- `quests` — массив из 3 (Normal/NM/Hell) с флагами квестов
- `items` — предметы на теле (slot → id)
- `inventory`, `cube`, `stash`, `belt` — сетки размещения
- `mercItems` — предметы наёмника
- `ironGolem` — ID голема (Necromancer)

### D2I — общий сундук

Файл: `src/formats/d2i-reader.ts` (277 строк).

**Формат D2I v105:** Последовательность секторов (страниц):

| Смещение (в секторе) | Размер | Описание |
|---|---|---|
| 0 | 4 | Magic: `0xAA55AA55` |
| 8 | 4 | Версия: `105` |
| 12 | 4 | Золото на странице |
| 16 | 4 | Размер сектора (в байтах) |
| 20 | 1 | Тип страницы (0=normal, 1=extended, 2=metadata) |
| 64 | ... | Данные предметов |

**Типы страниц:**

- **Normal (0):** Обычная страница сундука (16×13 сетка). Предметы парсятся как в D2S.
- **Extended (1):** Расширенная страница (gems + runes + materials). Разбивается на 3 виртуальных подстраницы:
  - `'gems'` — гемы (определяются через `isSubType(gd, type, 'gem')`)
  - `'runes'` — руны (через `isSubType(gd, type, 'rune')`)
  - `'misc'` — всё остальное (материалы и т.д.), размещение по фактическим размерам предметов в 10-колоночной сетке
- **Metadata (2):** Пропускается.

**Результат `readD2I()`:**

```ts
interface D2IReadResult {
  pages: D2IStashPage[];    // Массив страниц (extended разбиты на 3)
  items: Record<number, BinaryParsedItem>;
  warnings: string[];
}
```

`D2IStashPage` содержит:
- `index` — индекс в `pages[]`
- `pageType` — `0 | 1 | 'gems' | 'runes' | 'misc'`
- `gold` — золото
- `stash` — массив `(number | undefined)[]` (slot → itemId)
- `quantities` — количества для extended-предметов
- `offset` / `sectorSize` — позиция в оригинальном файле

---

## Парсинг предметов

### createItemParser

Файл: `src/formats/item-parser.ts` (590 строк).

Центральная функция создаёт контекст парсинга с замыканием:

```ts
function createItemParser(
  reader: BinaryReader,
  gd: GameData,
  initialId?: number,
): ItemParserContext
```

Возвращает:
- `parseItem(id, handler)` — парсинг одного предмета
- `parseItemList(handler)` — парсинг списка (читает `JM` хедер + count)
- `items` — словарь всех распарсенных предметов
- `nextId()` / `currentId` — управление ID

### BinaryParsedItem

Полное представление предмета после парсинга:

```ts
interface BinaryParsedItem {
  itemId: number;         // Уникальный ID в рамках файла
  base: string;           // 3-буквенный код (e.g. "cap", "rin")
  quality: number;        // 1-9 (LOW..CRAFTED, 9=RUNEWORD)
  ilvl: number;           // Item level
  unidentified: boolean;
  ethereal: boolean;
  socketed: boolean;
  sockets: number;        // Количество гнёзд
  socketedItems: number[];// ID вставленных предметов
  stats: Record<string, number>;  // Все статы
  unique?: string;        // Ключ в uniqueItems/setItems/runes (e.g. "unique042")
  name?: string;          // Имя для rare/crafted
  defense?: number;       // Защита (для armor)
  ethereal?: boolean;
  quantity?: number;      // Количество (для стакаемых)
  ear?: { class, level, name };  // Ear-предмет
  personalized?: string;  // Имя персонализации
  iconIndex?: number;     // Индекс варианта иконки
  custom?: boolean;       // Не удалось сопоставить с таблицами
  binaryOffset: { start, end }; // Диапазон бит в буфере

  // Мод-слоты (заполняются item-stats-parser)
  uniqueValues?: number[];          // Значения для unique/set
  mods?: Record<string, number[]>;  // Magic prefix/suffix моды
  auto?: Record<string, number[]>;  // Авто-моды
  staff?: Record<string, number[]>; // Staff моды
  crafted?: Record<string, number[]>; // Crafted моды
  superior?: Record<string, number[]>; // Superior моды
}
```

### Алгоритм чтения предмета

1. **Флаги (35 бит):** unidentified, socketed, ear, simple, ethereal, personalized, runeword
2. **Позиция (14 бит):** location(3), bodyloc(4), invcol(4), invrow(4), storage(3)
3. **Ear-обработка** (если ear=true): class(3), level(7), name(8-bit chars), return
4. **Код предмета:** 4 Huffman-символа (3 буквы + пробел)
5. **Simple item** (если simple=true): quantity flag + return
6. **Полный предмет:**
   - socketed items count (3 бита)
   - item types tree (для проверок)
   - item ID (32 бита, пропускается)
   - ilvl (7 бит)
   - quality (4 бита) → маппинг через `gameQualityMap`
   - icon index (опционально: 1 бит флаг + 3 бита)
   - auto mod (опционально: 1 бит флаг + 11 бит)
7. **Quality-специфичная секция:**
   - LOW: 3 бита
   - NORMAL: skip (12 бит для charms)
   - SUPERIOR: quality mod (3 бита)
   - MAGIC: prefix(11) + suffix(11)
   - SET: set item ID (12 бит) → `"set" + mkid(id)`
   - UNIQUE: unique item ID (12 бит) → `"unique" + mkid(id)`
   - RARE/CRAFTED: 2 rare-имени(8+8) + до 6 аффиксов (пары бит-флаг + 11 бит ID)
   - RUNEWORD: runeword ID (12 бит) + 4 бита skip
8. **Персонализация:** имя (8-bit chars до NUL)
9. **Book:** 5 бит skip
10. **v105 extended:** 1 бит флаг → misc(128 бит) или armo/weap(3 бита)
11. **Защита (armor):** 11 бит → обработка ethereal
12. **Прочность:** 8+9 бит (если durability > 0)
13. **v105 unknown bit:** 1 бит
14. **Stackable quantity:** 9 бит
15. **Sockets count:** 4 бита
16. **Set flags:** 5 бит (только для SET)
17. **Статы:** цикл `parseStats()` (9-бит ID до 511), set bonus stats, runeword stats
18. **Post-stats quantity:** 1 бит флаг + 8 бит
19. **Damage consolidation:** min/max/secondary/throw → max
20. **Мод-статы:** `parseUniqueStats` / `parseRunewordStats` / `parseModStats`
21. **Blunt bonus:** +50% undead damage
22. **Align:** выравнивание до байта
23. **Socketed items:** рекурсивный парсинг для каждого вложенного предмета

### Система статов

**Статы читаются циклом:**
1. 9 бит → stat ID (511 = конец)
2. `saveparambits` бит → param (если есть, для skill-статов)
3. `savebits` бит → value, минус `saveadd`

**Follow-статы:** Некоторые статы (fire/cold/poison damage, enhanced damage) сразу за собой имеют связанные статы. Таблица `followStats` определяет сколько.

**Skill-оn-event статы:** Кодируются как `stat#param` или `stat#param#value` в ключах. Например `item_singleskill#42 = 3` означает +3 к навыку 42.

**addStat()** — аккумулятор: суммирует значения (кроме `item_maxdamage_percent` — берёт max).

---

## Запись предметов

Файлы: `src/formats/item-writer.ts`, `src/formats/d2s-writer.ts`, `src/formats/d2i-writer.ts`.

**writeItem()** — обратная операция к парсингу: собирает биты предмета в массив байт.

**writeD2S()** — полная перезапись D2S файла:
- Записывает хедер, статы, навыки
- Записывает все предметы (body + stored + belt)
- Пересчитывает контрольную сумму

**writeStash() / patchStashPage()** — для D2I:
- `patchStashPage()` — заменяет один сектор в существующем буфере
- `writeStash()` — полная перезапись файла

---

## GameData — регистр игровых данных

Файл: `src/game-data/game-data.ts` (380 строк).

Центральный класс, хранящий все обработанные таблицы. Создаётся один раз, передаётся во все функции.

### Загрузка

```ts
// Из файлов
const gd = await GameData.fromFile('data.json', 'strings.json');

// Из готовых объектов
const gd = GameData.fromRaw(rawData, locale);
```

`loader.ts` читает JSON и парсит `strings.json` как `LocaleArray` — массив кортежей `[key, value]`.

### processData — 14 шагов обработки

Вызывается при создании инстанса:

| # | Шаг | Описание |
|---|---|---|
| 1 | Object.assign | Копирование всех raw-таблиц на `this` |
| 2 | stash defaults | `info.stash = { rows: 13, columns: 16 }` |
| 3 | Locale setup | Построение `locale.strings`, `locale.istrings`, `locale.stringi` из массива `[key, value]` |
| 4 | reorderStatPriorities | Пересортировка `itemStatCost.descpriority` по весу (priority + id×0.001 + корректировки) |
| 5 | generateStaffMods | Генерация аффиксов для staff-модов из таблицы навыков |
| 6 | Version filtering | ПРОПУЩЕНО (Blizzless v105 = всегда актуальная версия) |
| 7 | magicPrefix/Suffix filter | Оставляем только `version > 0 && version <= 100` |
| 8 | hireling filter | Оставляем только `version === 100` |
| 9 | items merge | `this.items = { ...armor, ...misc, ...weapons }` |
| 10 | mods merge | `this.mods = { ...autoMagic, ...magicPrefix, ...magicSuffix, ...crafted, ...qualityItems, ...staffMods }` |
| 11 | fixupMods | Нормализация sock/rep-quant, исправление dmg-ac инверсии |
| 12 | buildLookupMaps | Построение `skillByName`, `stateByName`, `missileByName`, `monsterById` |
| 13 | itemStatCost overrides | Ручные патчи: `item_extra_stack`, `item_replenish_quantity` |
| 14 | Locale patch | `ModStre9vx += " [1 in %d sec.]"` |

### Типы данных

Файл: `src/game-data/types.ts` (472 строки).

`RawGameData` — структура `data.json`:

```ts
interface RawGameData {
  armor: Record<string, ArmorEntry>;
  weapons: Record<string, WeaponEntry>;
  misc: Record<string, MiscEntry>;
  itemStatCost: Record<string, ItemStatCostEntry>;
  itemTypes: Record<string, ItemTypeEntry>;
  uniqueItems: Record<string, UniqueItemEntry>;
  setItems: Record<string, SetItemEntry>;
  sets: Record<string, SetEntry>;
  runes: Record<string, RunewordEntry>;
  magicPrefix: Record<string, MagicAffixEntry>;
  magicSuffix: Record<string, MagicAffixEntry>;
  autoMagic: Record<string, MagicAffixEntry>;
  crafted: Record<string, MagicAffixEntry>;
  qualityItems: Record<string, QualityItemEntry>;
  gems: Record<string, GemEntry>;
  skills: Record<string, SkillEntry>;
  properties: Record<string, PropertyEntry>;
  states: Record<string, StateEntry>;
  monsters: Record<string, MonsterEntry>;
  monstersEx: Record<string, MonsterEntry>;
  missiles: Record<string, MissileEntry>;
  hireling: Record<string, HirelingEntry>;
  charStats: Record<string, CharStatEntry>;
  rarePrefix: Record<string, RareAffixEntry>;
  rareSuffix: Record<string, RareAffixEntry>;
  experience: Record<string, ExperienceEntry>;
  belts: Record<string, BeltEntry>;
  info: GameInfo;
  strings: Record<string, string>;
}
```

Все таблицы — `Record<string, Entry>` где ключ = строковый ID записи.

### Производные поля

Поля, вычисляемые в `processData()`:

| Поле | Тип | Описание |
|---|---|---|
| `items` | `Record<string, ItemEntry>` | armor + misc + weapons |
| `mods` | `Record<string, MagicAffixEntry>` | autoMagic + prefix + suffix + crafted + qualityItems + staffMods |
| `staffMods` | `Record<string, MagicAffixEntry>` | Сгенерированные staff-моды |
| `skillByName` | `Record<string, SkillEntry>` | skill.toLowerCase() → entry |
| `stateByName` | `Record<string, StateEntry>` | state.toLowerCase() → entry |
| `missileByName` | `Record<string, MissileEntry>` | missile.toLowerCase() → entry |
| `monsterById` | `MonsterEntry[]` | monster.hcidx → entry |
| `locale` | `LocaleStore` | strings + istrings + stringi |

---

## Система предметов

### Сериализация токенов

Файл: `src/items/item-serializer.ts` (116 строк).

Предметы передаются между сейвами через портативные токены.

**Формат:** `d2r1:<base64>`

- `d2r1:` — префикс версии формата (константа `TOKEN_PREFIX`)
- `<base64>` — бинарные данные предмета (результат `writeItem()` с нулевыми координатами)

**Сериализация:**
```
BinaryParsedItem → writeItem(item, zerоLoc) → bytes → base64 → "d2r1:" + base64
```

**Десериализация:**
```
"d2r1:..." → base64 → bytes → wrap в JM-пакет → createItemParser → BinaryParsedItem
```

При десериализации байты оборачиваются в `JM` хедер (4 байта: "JM" + count=1) чтобы `createItemParser.parseItemList()` мог их прочитать.

### Иконки

Файл: `src/items/item-icon.ts` (116 строк).

**`getItemIconPath(item, gd)`** — HD иконка:
1. Берёт `base.hd` из GameData
2. Для UNIQUE/SET предметов проверяет `uniqueItems[key].hd` / `setItems[key].hd`
3. Для предметов с `varinvgfx` (вариантные иконки) выбирает по `item.iconIndex`

**`getItemIconSD(item, gd)`** — SD иконка:
- Возвращает `base.invfile`, с проверкой `uniqueinvfile` / `setinvfile`

### Trade DTO

Файл: `src/items/item-dto.ts` (163 строки).

Конвертирует `BinaryParsedItem` → `TradeItemDTO` для бэкенда:

```ts
interface TradeItemDTO {
  token: string;        // d2r1:<base64>
  baseCode: string;     // 3-буквенный код
  displayName: string;  // Локализованное имя
  quality: ItemQuality; // 1-9
  ilvl: number;
  ethereal: boolean;
  sockets: number;
  uniqueId?: string;    // unique042, set005, runeword048...
  width: number;
  height: number;
  iconPath: string | null;
  stats: Record<string, number>;
  socketedItems: TradeItemDTO[];  // Рекурсивно для вложенных
}
```

**Разрешение имени** (`resolveDisplayName`):
1. `item.name` (для rare/crafted)
2. `lookupName(item.unique)` — из locale / uniqueItems / setItems
3. `locale.strings[base.namestr]` — базовое имя из локализации

---

## Операции

### Extract (извлечение)

Файл: `src/operations/extract-item.ts` (269 строк).

**`extractItemD2S(buffer, itemId, gd)`:**
1. `readD2S()` → profile + items
2. Находит предмет по `itemId`
3. `collectItemAndSockets()` — собирает ID предмета + все socketed sub-items
4. Удаляет из всех слотов profile (stash, inventory, cube, belt, items, mercItems, ironGolem)
5. `writeD2S()` → новый буфер без предмета
6. Возвращает `{ newBuffer, extractedItem, extractedAllItems }`

**`extractItemD2I(buffer, pageIndex, x, y, gd)`:**
1. `readD2I()` → pages + items
2. Находит предмет по позиции `page.stash[y * columns + x]`
3. Собирает socketed sub-items
4. Удаляет из stash-массива страницы
5. `patchStashPage()` → новый буфер с пропатченным сектором
6. Возвращает `{ newBuffer, extractedItem, extractedAllItems }`

### Insert (вставка)

Файл: `src/operations/insert-item.ts` (282 строки).

**`insertItemD2S(buffer, item, allItems, target, gd, position?)`:**
1. `readD2S()` → profile + items
2. Определяет целевую сетку: `'stash'` / `'inventory'` / `'cube'`
3. `buildGrid()` → сетка занятости из текущих предметов
4. Если `position` задана → `canPlaceItem()`, иначе → `findFreeSlot()`
5. Назначает новые ID предмету и его сокетам (max existing ID + 1)
6. Записывает в slot-массив и items dict
7. `writeD2S()` → новый буфер

**`insertItemD2I(buffer, item, allItems, gd, target?)`:**
1. `readD2I()` → pages + items
2. Фильтрует только нормальные страницы (pageType=0)
3. Если `target` задан → проверяет конкретную позицию
4. Иначе → перебирает все нормальные страницы, ищет `findFreeSlot()`
5. Назначает новые ID, регистрирует
6. `patchStashPage()` → патч буфера

### readSave

Файл: `src/operations/read-save.ts` (50 строк).

Discriminated union:

```ts
type ReadSaveResult =
  | { type: 'd2s'; data: D2SReadResult }
  | { type: 'd2i'; data: D2IReadResult };
```

Вызывает `detectFormat()` + соответствующий ридер.

---

## Инвентарная сетка

### StashGrid

Файл: `src/inventory/grid.ts` (132 строки).

2D сетка занятости на `Float64Array`:

```ts
class StashGrid {
  readonly rows: number;
  readonly columns: number;
  private cells: Float64Array;  // 0=свободно, иначе item ID
}
```

| Метод | Описание |
|---|---|
| `isFree(x, y, w, h)` | Проверка прямоугольной области |
| `at(x, y)` | Получить ID в ячейке |
| `occupy(x, y, w, h, itemId)` | Занять область |
| `free(x, y, w, h)` | Освободить |
| `clear()` | Полная очистка |
| `findFreeSlot(w, h)` | Поиск свободного места (left-to-right, top-to-bottom) |
| `populate(slots, items, gd)` | Заполнение из slot-массива (из ридера) |

### Размеры сеток

Файл: `src/inventory/dimensions.ts`.

| Сетка | Размер | Константы |
|---|---|---|
| Stash | 16×13 | `STASH_WIDTH=16`, `STASH_HEIGHT=13` |
| Inventory | 10×4 | `INVENTORY_WIDTH=10`, `INVENTORY_HEIGHT=4` |
| Cube | 3×4 | `CUBE_WIDTH=3`, `CUBE_HEIGHT=4` |

### Placement

Файл: `src/inventory/placement.ts` (139 строк).

| Функция | Описание |
|---|---|
| `canPlaceItem(grid, x, y, item, gd)` | Проверка размещения |
| `findFreeSlot(grid, item, gd)` | Первое свободное место |
| `findFreeSlotInStash(grids, item, gd)` | Поиск через массив страниц |
| `placeItem(grid, x, y, item, gd)` | Занять место |
| `removeItem(grid, x, y, item, gd)` | Освободить место |
| `buildGrid(size, slots, items, gd)` | Создать сетку из slot-массива |

Размер предмета берётся из `gd.items[item.base].invwidth/invheight`.

---

## Обработка ошибок

Файл: `src/types/errors.ts` (59 строк).

```ts
class D2RSaverError extends Error {
  readonly name = 'D2RSaverError';
  readonly code: ErrorCode;
}

enum ErrorCode {
  INVALID_FORMAT       // Неверный формат файла
  UNSUPPORTED_VERSION  // Неподдерживаемая версия
  PARSE_ERROR          // Ошибка парсинга
  CHECKSUM_MISMATCH    // Несовпадение контрольной суммы
  NO_FREE_SLOT         // Нет свободного места
  ITEM_NOT_FOUND       // Предмет не найден
  WRITE_ERROR          // Ошибка записи
  INVALID_TOKEN        // Невалидный токен сериализации
  DATA_NOT_LOADED      // Данные не загружены
}
```

---

## Data Pipeline

Генерация `data.json` и `strings.json` из исходных TSV-файлов игры.

Запуск: `npm run build:data` (использует `tsx` для TypeScript).

### Исходные файлы

```
data/
├── txt/                        ← Исходные TSV таблицы
│   ├── Armor.txt
│   ├── Weapons.txt
│   ├── Misc.txt
│   ├── UniqueItems.txt
│   ├── SetItems.txt
│   ├── Sets.txt
│   ├── Runes.txt
│   ├── ItemStatCost.txt
│   ├── ItemTypes.txt
│   ├── MagicPrefix.txt
│   ├── MagicSuffix.txt
│   ├── Skills.txt
│   ├── SkillDesc.txt
│   ├── Properties.txt
│   ├── Gems.txt
│   ├── States.txt
│   ├── Monsters.txt
│   ├── ... (40 файлов)
│   └── strings/                ← JSON-файлы локализации
│       ├── item-modifiers.json
│       ├── item-names.json
│       ├── item-runes.json
│       ├── item-nameaffixes.json
│       ├── levels.json
│       ├── mercenaries.json
│       ├── monsters.json
│       ├── skills.json
│       └── ui.json
├── json/                       ← Промежуточные JSON (генерируется)
└── hd/
    └── items/                  ← HD-данные иконок
        ├── hditemlib.json
        └── info.json
```

### Парсеры

36 парсеров в `src/data-parser/parsers/`:

```
armor.ts, auto-magic.ts, belts.ts, char-stats.ts, difficulty.ts,
experience.ts, gems.ts, hireling.ts, item-ratio.ts, item-stat-cost.ts,
item-types.ts, levels.ts, magic-prefix.ts, magic-suffix.ts, misc.ts,
missiles.ts, mon-equip.ts, mon-lvl.ts, mon-prop.ts, mon-type.ts,
monsters-ex.ts, monsters.ts, properties.ts, quality-items.ts,
rare-prefix.ts, rare-suffix.ts, runes.ts, set-items.ts, sets.ts,
skill-desc.ts, skills.ts, states.ts, super-uniques.ts,
treasure-class.ts, unique-items.ts, weapons.ts
```

Каждый парсер:
1. `readGameFile('FileName')` — читает TSV
2. Парсит строки, маппит колонки на поля
3. `writeJson('filename', data)` — записывает в `data/json/`

Утилиты:
- `readGameFile(name)` — читает `data/txt/{name}.txt`, пропускает заголовок и "Expansion" строки, разбивает по `\t`
- `writeJson(name, data)` — записывает `data/json/{name}.json`
- `toNumber(str)` — конвертация строк в числа (с обработкой пустых строк)
- `getHD(code)` — HD-иконка из `hditemlib.json`
- `getSkillId(skillName)` — ID навыка по имени (с lazy-load из `skills.json`)

### Оркестратор

Файл: `src/data-parser/generate-all.ts` (108 строк).

4-фазное выполнение:

```
Phase 1: skills + skillDesc (bootstrap: getSkillId ещё не работает)
Phase 2: сброс кеша getSkillId (теперь skills.json существует)
Phase 3: skills повторно (теперь getSkillId работает)
Phase 4: все остальные парсеры (item/world tables)
```

Это решает проблему курицы и яйца: `getSkillId` читает `skills.json`, но `skills.json` создаётся парсером skills.

### Merge

Файл: `src/data-parser/merge-json.ts`.

После генерации всех отдельных JSON, `mergeJsonFiles()` объединяет их в один `data.json`:

```
data/json/*.json → data/data.json
```

Имя файла (без `.json`) становится ключом: `armor.json` → `data.armor`.

### Строковые ресурсы

Файл: `src/data-parser/strings.ts`.

`generateStrings()` — объединяет все JSON-файлы из `data/txt/strings/` в один массив `[key, value][]` и записывает `data/strings.json`.

### Полный пайплайн (index.ts)

```
npm run build:data
  ├── [1/3] generateStrings() → data/strings.json
  ├── [2/3] generateAll()     → data/json/*.json (37 файлов)
  └── [3/3] mergeJsonFiles()  → data/data.json (~3.24 MB)
```

Общее время: ~540ms.

---

## Тестирование

302 теста, Vitest.

```bash
npm test
```

Тесты покрывают:
- Бинарный ридер/райтер (чтение бит, выравнивание, Huffman)
- Чтение D2S/D2I файлов (реальные save-файлы в fixtures)
- Запись D2S/D2I (round-trip: read → write → read)
- Извлечение/вставка предметов
- Сериализация/десериализация токенов
- Инвентарная сетка (isFree, occupy, findFreeSlot)
- GameData (processData, lookup maps)
- Item icon resolution
- Trade DTO conversion
- Error handling

---

## Trade-флоу (полный цикл)

```
Sender                                    Receiver
──────                                    ────────
1. readD2S/D2I(buffer)                    
2. extractItemD2S/D2I(buffer, id/pos)     
   → { newBuffer, extractedItem }         
3. serializeItem(item, allItems)          
   → "d2r1:Abc123..."                     
4. toTradeDTO(item, allItems)             
   → TradeItemDTO (для бэкенда)           
                                          
   ─── токен передаётся через API ───     
                                          
                                          5. deserializeItem("d2r1:Abc123...")
                                             → { item, allItems }
                                          6. insertItemD2S/D2I(buffer, item, allItems)
                                             → { newBuffer, position }
```

**Ключевой контракт:** Токен `d2r1:` полностью самодостаточен — содержит все биты предмета (включая socketed sub-items). После десериализации предмет можно вставить в любой сейв без дополнительных данных.
