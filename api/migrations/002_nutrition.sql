CREATE TABLE nutrition_products (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  name TEXT GENERATED ALWAYS AS (json_extract(document, '$.name')) VIRTUAL,
  barcode TEXT GENERATED ALWAYS AS (json_extract(document, '$.barcode')) VIRTUAL,
  unit TEXT GENERATED ALWAYS AS (json_extract(document, '$.unit')) VIRTUAL,
  kcal REAL GENERATED ALWAYS AS (json_extract(document, '$.values.energy')) VIRTUAL,
  PRIMARY KEY(user_id, id)
);
CREATE UNIQUE INDEX nutrition_product_barcode ON nutrition_products(user_id,barcode) WHERE barcode IS NOT NULL AND barcode <> '';

CREATE TABLE nutrition_meals (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  name TEXT GENERATED ALWAYS AS (json_extract(document, '$.name')) VIRTUAL,
  servings REAL GENERATED ALWAYS AS (json_extract(document, '$.servings')) VIRTUAL,
  PRIMARY KEY(user_id, id)
);

CREATE TABLE nutrition_ingredients (
  user_id TEXT NOT NULL,
  meal_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  product_snapshot TEXT NOT NULL CHECK(json_valid(product_snapshot)),
  amount REAL NOT NULL CHECK(amount > 0),
  PRIMARY KEY(user_id, meal_id, position),
  FOREIGN KEY(user_id, meal_id) REFERENCES nutrition_meals(user_id,id) ON DELETE CASCADE
);

CREATE TABLE nutrition_diary (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  date TEXT GENERATED ALWAYS AS (json_extract(document, '$.date')) VIRTUAL,
  meal_slot TEXT GENERATED ALWAYS AS (json_extract(document, '$.slot')) VIRTUAL,
  amount REAL GENERATED ALWAYS AS (json_extract(document, '$.amount')) VIRTUAL,
  item_id TEXT GENERATED ALWAYS AS (json_extract(document, '$.item.id')) VIRTUAL,
  PRIMARY KEY(user_id, id)
);
CREATE INDEX nutrition_diary_date ON nutrition_diary(user_id,date);

CREATE TABLE nutrition_plan (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  date TEXT GENERATED ALWAYS AS (json_extract(document, '$.date')) VIRTUAL,
  meal_slot TEXT GENERATED ALWAYS AS (json_extract(document, '$.slot')) VIRTUAL,
  amount REAL GENERATED ALWAYS AS (json_extract(document, '$.amount')) VIRTUAL,
  item_id TEXT GENERATED ALWAYS AS (json_extract(document, '$.item.id')) VIRTUAL,
  PRIMARY KEY(user_id, id)
);
CREATE INDEX nutrition_plan_date ON nutrition_plan(user_id,date);
CREATE TABLE nutrition_shopping (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  week TEXT GENERATED ALWAYS AS (json_extract(document, '$.week')) VIRTUAL,
  checked INTEGER GENERATED ALWAYS AS (json_extract(document, '$.checked')) VIRTUAL,
  PRIMARY KEY(user_id, id)
);
CREATE TABLE nutrition_profiles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  height_cm REAL GENERATED ALWAYS AS (json_extract(document, '$.height')) VIRTUAL,
  goal TEXT GENERATED ALWAYS AS (json_extract(document, '$.goal')) VIRTUAL,
  PRIMARY KEY(user_id, id)
);
