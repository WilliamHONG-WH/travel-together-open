-- ============================================================
-- Let's Travel Together — 完整数据库 Schema（纯表结构，无任何行数据）
-- ============================================================
-- 与当前代码（src/）实际使用的表结构和字段 100% 对齐，
-- 整合 supabase/migrations/ 全部迁移的最终状态。
--
-- 覆盖模块：
--   账号与行程   profiles / trips / trip_members
--   地图与打卡   checkins / user_locations / user_stamps
--   聊天         messages（含消息撤回 is_recalled）
--   行程规划     trip_items / user_item_checks / trip_plans / trip_announcements
--   美食         trip_food_plans / trip_food_guides / trip_restaurants
--   酒店         hotels
--   百科         encyclopedia_items
--   票据         receipts（多图 images）
--   推送         user_push_subscriptions
--   存储         checkin-images / avatars 两私密桶 + public-images 一公开桶 + RLS 策略
--
-- 在全新的 Supabase 项目上按顺序执行即可完整复刻当前数据库。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================
-- ENUM: 消息类型
-- =========================================
CREATE TYPE public.message_type AS ENUM ('text', 'checkin_share');

-- =========================================
-- profiles 用户资料（策略延后至 trip_members 与 is_trip_member 就绪后统一挂载）
-- =========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Traveler',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =========================================
-- trips 行程（策略延后至 is_trip_member 函数之后统一挂载）
-- =========================================
CREATE TABLE public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips TO authenticated;
GRANT ALL ON public.trips TO service_role;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- =========================================
-- trip_members 行程成员
-- =========================================
CREATE TABLE public.trip_members (
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);
CREATE INDEX idx_trip_members_user ON public.trip_members(user_id);
CREATE INDEX idx_trip_members_trip_user ON public.trip_members(trip_id, user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_members TO authenticated;
GRANT ALL ON public.trip_members TO service_role;
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;

-- =========================================
-- Security definer helper: is_trip_member
-- （必须先于所有调用它的 RLS 策略创建，新库顺序执行才不会报 function does not exist）
-- =========================================
CREATE OR REPLACE FUNCTION public.is_trip_member(_trip_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = _trip_id AND user_id = _user_id
  );
$$;

-- =========================================
-- 基础表 RLS 策略（trips / trip_members / profiles —— 表与函数均已就绪）
-- =========================================

-- trips
CREATE POLICY "Members can view their trips" ON public.trips
  FOR SELECT TO authenticated
  USING (public.is_trip_member(id, auth.uid()) OR created_by = auth.uid());
CREATE POLICY "Users can create trips" ON public.trips
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Creators can update trips" ON public.trips
  FOR UPDATE TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "Creators can delete trips" ON public.trips
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- trip_members
CREATE POLICY "Members can view trip members" ON public.trip_members
  FOR SELECT TO authenticated USING (public.is_trip_member(trip_id, auth.uid()));
-- 入团仅两条受控通道（均为 SECURITY DEFINER，绕过 RLS）：
-- 建团触发器 add_creator_as_member 与 join_trip_by_code RPC。
-- 不设普通 INSERT 策略：禁止用户凭 trip UUID 绕过邀请码直插任意行程。
CREATE POLICY "Users can leave trips" ON public.trip_members
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- profiles（SELECT 策略引用 trip_members 表，同样需在其之后创建）
CREATE POLICY "Profiles viewable by trip co-members" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.trip_members tm1
      JOIN public.trip_members tm2 ON tm1.trip_id = tm2.trip_id
      WHERE tm1.user_id = auth.uid() AND tm2.user_id = profiles.id
    )
  );
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- =========================================
-- checkins 打卡
-- category: 打卡分类；city: 逆地理编码城市标签
-- =========================================
CREATE TABLE public.checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  note TEXT,
  image_url TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  category TEXT,
  city TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_checkins_trip ON public.checkins(trip_id);
CREATE INDEX idx_checkins_city ON public.checkins(trip_id, city);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkins TO authenticated;
GRANT ALL ON public.checkins TO service_role;
ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view checkins" ON public.checkins
  FOR SELECT TO authenticated USING (public.is_trip_member(trip_id, auth.uid()));
CREATE POLICY "Members can create own checkins" ON public.checkins
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id AND public.is_trip_member(trip_id, auth.uid())
  );
CREATE POLICY "Users can update own checkins" ON public.checkins
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own checkins" ON public.checkins
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =========================================
-- user_locations 成员实时位置共享
-- =========================================
CREATE TABLE public.user_locations (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  sharing_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, trip_id)
);
CREATE INDEX idx_user_locations_trip ON public.user_locations(trip_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_locations TO authenticated;
GRANT ALL ON public.user_locations TO service_role;
ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view locations" ON public.user_locations
  FOR SELECT TO authenticated USING (public.is_trip_member(trip_id, auth.uid()));
CREATE POLICY "Users can insert own location" ON public.user_locations
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id AND public.is_trip_member(trip_id, auth.uid())
  );
CREATE POLICY "Users can update own location" ON public.user_locations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own location" ON public.user_locations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =========================================
-- messages 聊天消息
-- is_recalled: 消息撤回标记（撤回后全团 Realtime 广播，气泡显示"已撤回"）
-- =========================================
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type public.message_type NOT NULL DEFAULT 'text',
  checkin_id UUID REFERENCES public.checkins(id) ON DELETE SET NULL,
  is_recalled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_trip_created ON public.messages(trip_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view messages" ON public.messages
  FOR SELECT TO authenticated USING (public.is_trip_member(trip_id, auth.uid()));
CREATE POLICY "Members can send messages" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id AND public.is_trip_member(trip_id, auth.uid())
  );
CREATE POLICY "Users can recall own messages" ON public.messages
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own messages" ON public.messages
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =========================================
-- trip_items 物品清单（Packing List）
-- =========================================
CREATE TABLE public.trip_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  city TEXT DEFAULT NULL,
  latitude DOUBLE PRECISION DEFAULT NULL,
  longitude DOUBLE PRECISION DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_trip_items_city ON public.trip_items(trip_id, city);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_items TO authenticated;
GRANT ALL ON public.trip_items TO service_role;
ALTER TABLE public.trip_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trip members can view trip items" ON public.trip_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = trip_items.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
    OR created_by::text = auth.uid()::text
  );
CREATE POLICY "Trip members can insert trip items" ON public.trip_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = trip_items.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
    AND created_by::text = auth.uid()::text
  );
CREATE POLICY "Trip members can update trip items" ON public.trip_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = trip_items.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
    OR created_by::text = auth.uid()::text
  );
CREATE POLICY "Trip members can delete trip items" ON public.trip_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = trip_items.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
    OR created_by::text = auth.uid()::text
  );

-- =========================================
-- user_item_checks 物品打勾记录（每队员每物品一行）
-- item_id 外键 ON DELETE CASCADE：删除物品时级联删除所有打勾记录
-- =========================================
CREATE TABLE public.user_item_checks (
  item_id UUID NOT NULL REFERENCES public.trip_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_checked BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (item_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_item_checks TO authenticated;
GRANT ALL ON public.user_item_checks TO service_role;
ALTER TABLE public.user_item_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own item checks" ON public.user_item_checks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =========================================
-- trip_plans 行程规划（多方案 itinerary）
-- plan_name 区分多方案（PLAN A / PLAN B ...）
-- =========================================
CREATE TABLE public.trip_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  plan_name TEXT DEFAULT 'PLAN A',
  plan_date DATE,
  plan_time TEXT,
  day_title TEXT,
  time_label TEXT,
  location TEXT,
  activity TEXT,
  sequence INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trip_plans_trip_id ON public.trip_plans(trip_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_plans TO authenticated;
GRANT ALL ON public.trip_plans TO service_role;
ALTER TABLE public.trip_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read trip plans" ON public.trip_plans
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_plans.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can insert trip plans" ON public.trip_plans
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_plans.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can update trip plans" ON public.trip_plans
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_plans.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can delete trip plans" ON public.trip_plans
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_plans.trip_id
      AND tm.user_id = auth.uid()
    )
  );

-- =========================================
-- trip_food_plans 美食计划（Gastronomy 模块）
-- =========================================
CREATE TABLE public.trip_food_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  plan_name TEXT DEFAULT 'PLAN A',
  plan_date DATE,
  day_title TEXT,
  course_type TEXT DEFAULT 'Starter',
  dish_name TEXT,
  description TEXT,
  sequence INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_trip_food_plans_trip_id ON public.trip_food_plans(trip_id);
CREATE INDEX idx_trip_food_plans_date ON public.trip_food_plans(trip_id, plan_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_food_plans TO authenticated;
GRANT ALL ON public.trip_food_plans TO service_role;
ALTER TABLE public.trip_food_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read food plans" ON public.trip_food_plans
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_food_plans.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can insert food plans" ON public.trip_food_plans
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_food_plans.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can update food plans" ON public.trip_food_plans
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_food_plans.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can delete food plans" ON public.trip_food_plans
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_food_plans.trip_id
      AND tm.user_id = auth.uid()
    )
  );

-- =========================================
-- trip_food_guides 美食指南（每行程一份）
-- =========================================
CREATE TABLE public.trip_food_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE REFERENCES public.trips(id) ON DELETE CASCADE,
  content TEXT,
  updated_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_trip_food_guides_trip_id ON public.trip_food_guides(trip_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_food_guides TO authenticated;
GRANT ALL ON public.trip_food_guides TO service_role;
ALTER TABLE public.trip_food_guides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read food guides" ON public.trip_food_guides
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_food_guides.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can insert food guides" ON public.trip_food_guides
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_food_guides.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can update food guides" ON public.trip_food_guides
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_food_guides.trip_id
      AND tm.user_id = auth.uid()
    )
  );

-- =========================================
-- trip_restaurants 餐厅表（美食规划「餐厅视图」）
-- dishes: [{ id, name, price, note }]；attachments: Storage 相对路径数组
-- latitude / longitude: 地址正向地理编码自动回填，地图标记依赖
-- =========================================
CREATE TABLE public.trip_restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT,
  country TEXT,
  meal_type TEXT DEFAULT 'dinner',
  address TEXT,
  hours TEXT,
  notes TEXT,
  dishes JSONB DEFAULT '[]'::jsonb,
  attachments JSONB DEFAULT '[]'::jsonb,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_trip_restaurants_trip_id ON public.trip_restaurants(trip_id);
CREATE INDEX idx_trip_restaurants_created_at ON public.trip_restaurants(trip_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_restaurants TO authenticated;
GRANT ALL ON public.trip_restaurants TO service_role;
ALTER TABLE public.trip_restaurants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read restaurants" ON public.trip_restaurants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_restaurants.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can insert restaurants" ON public.trip_restaurants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_restaurants.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can update restaurants" ON public.trip_restaurants
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_restaurants.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can delete restaurants" ON public.trip_restaurants
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = trip_restaurants.trip_id
      AND tm.user_id = auth.uid()
    )
  );

-- =========================================
-- user_stamps 足迹册 / 邮票集（打卡数据源）
-- country: 国家标准化 key（checkin-modal 写入）
-- is_featured: 精选邮票开关（仅创建者可切换）
-- =========================================
CREATE TABLE public.user_stamps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'Untitled',
  city TEXT,
  country TEXT,
  photo_url TEXT,
  notes TEXT,
  category TEXT DEFAULT 'attraction',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  is_featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_user_stamps_trip_id ON public.user_stamps(trip_id);
CREATE INDEX idx_user_stamps_trip_city ON public.user_stamps(trip_id, city);
CREATE INDEX idx_user_stamps_created_by ON public.user_stamps(created_by);
CREATE INDEX idx_user_stamps_featured ON public.user_stamps(trip_id, is_featured) WHERE is_featured = TRUE;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_stamps TO authenticated;
GRANT ALL ON public.user_stamps TO service_role;
ALTER TABLE public.user_stamps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read stamps" ON public.user_stamps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = user_stamps.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can insert stamps" ON public.user_stamps
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = user_stamps.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Creators can update stamps" ON public.user_stamps
  FOR UPDATE USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "Creators can delete stamps" ON public.user_stamps
  FOR DELETE USING (created_by = auth.uid());

-- =========================================
-- receipts 票据表（多图票据）
-- images: 多图路径 JSONB 数组（旧数据单图存 image_url，读取侧向下兼容）
-- recorder / recorder_name / recorder_avatar_url: 记录人快照
-- =========================================
CREATE TABLE public.receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id         TEXT,
  title           TEXT NOT NULL,
  image_url       TEXT DEFAULT '',
  images          JSONB DEFAULT '[]'::jsonb,
  amount          NUMERIC NOT NULL DEFAULT 0,
  currency        TEXT DEFAULT 'CNY',
  date            TEXT NOT NULL,
  city_key        TEXT,
  location        TEXT,
  detail_address  TEXT,
  recorder        TEXT,
  recorder_name   TEXT,
  recorder_avatar_url TEXT,
  note            TEXT,
  is_shared       BOOLEAN DEFAULT false,
  is_starred      BOOLEAN DEFAULT false
);
CREATE INDEX idx_receipts_trip_id    ON public.receipts(trip_id);
CREATE INDEX idx_receipts_user_id    ON public.receipts(user_id);
CREATE INDEX idx_receipts_created_at ON public.receipts(created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipts TO authenticated;
GRANT ALL ON public.receipts TO service_role;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

-- 行程成员 OR 本人全权读写（同一 trip_id 的队员可互看/协作编辑票据）
-- trip_members.trip_id 为 UUID，receipts.trip_id 为 TEXT，统一 ::text 后比较
CREATE POLICY "Users can view receipts of their trips"
  ON public.receipts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = receipts.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
    OR user_id::text = auth.uid()::text
  );
CREATE POLICY "Users can insert receipts to their trips"
  ON public.receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = receipts.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
    OR user_id::text = auth.uid()::text
  );
CREATE POLICY "Users can update receipts of their trips"
  ON public.receipts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = receipts.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
    OR user_id::text = auth.uid()::text
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = receipts.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
    OR user_id::text = auth.uid()::text
  );
CREATE POLICY "Users can delete receipts of their trips"
  ON public.receipts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = receipts.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
    OR user_id::text = auth.uid()::text
  );

-- =========================================
-- encyclopedia_items 百科条目（博物馆百科模块）
-- exhibits / masterpieces / artifacts / attachments: JSONB 内容
-- latitude / longitude: 正向地理编码回填，地图金色星标依赖
-- status: 计划状态字段（代码注释中声明的真实 Schema 字段）
-- =========================================
CREATE TABLE public.encyclopedia_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  trip_id         TEXT NOT NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title           TEXT NOT NULL DEFAULT '',
  subtitle        TEXT DEFAULT '',
  sub_title       TEXT DEFAULT '',
  description     TEXT DEFAULT '',
  introduction    TEXT DEFAULT '',
  image_url       TEXT DEFAULT '',
  address         TEXT DEFAULT '',
  location        TEXT DEFAULT '',
  opening_hours   TEXT DEFAULT '',
  hours           TEXT DEFAULT '',
  status          TEXT,
  exhibits        JSONB DEFAULT '[]'::jsonb,
  masterpieces    JSONB DEFAULT '[]'::jsonb,
  artifacts       JSONB DEFAULT '[]'::jsonb,
  attachments     JSONB DEFAULT '[]'::jsonb,
  country_key     TEXT DEFAULT '',
  city_key        TEXT DEFAULT '',
  is_planned      BOOLEAN DEFAULT false,
  planned         BOOLEAN DEFAULT false,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION
);
CREATE INDEX idx_encyclopedia_items_trip_id    ON public.encyclopedia_items(trip_id);
CREATE INDEX idx_encyclopedia_items_created_at ON public.encyclopedia_items(created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.encyclopedia_items TO authenticated;
GRANT ALL ON public.encyclopedia_items TO service_role;
ALTER TABLE public.encyclopedia_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read encyclopedia items"
  ON public.encyclopedia_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = encyclopedia_items.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
  );
CREATE POLICY "Members can insert encyclopedia items"
  ON public.encyclopedia_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = encyclopedia_items.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
  );
CREATE POLICY "Members can update encyclopedia items"
  ON public.encyclopedia_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = encyclopedia_items.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
  );
CREATE POLICY "Members can delete encyclopedia items"
  ON public.encyclopedia_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_members.trip_id::text = encyclopedia_items.trip_id::text
        AND trip_members.user_id::text = auth.uid()::text
    )
  );

-- =========================================
-- hotels 酒店表（住宿模块）
-- check_in_date / check_out_date: YYYY-MM-DD 入住/退房日期
-- is_starred: 星标；updated_at: 前端保存时写入
-- =========================================
CREATE TABLE public.hotels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  city            TEXT DEFAULT '',
  country         TEXT DEFAULT '',
  address         TEXT DEFAULT '',
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  check_in_date   DATE,
  check_out_date  DATE,
  notes           TEXT DEFAULT '',
  cover_image_url TEXT DEFAULT '',
  is_starred      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_hotels_trip_id ON public.hotels(trip_id);
CREATE INDEX idx_hotels_trip_created ON public.hotels(trip_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hotels TO authenticated;
GRANT ALL ON public.hotels TO service_role;
ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read hotels" ON public.hotels
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = hotels.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can insert hotels" ON public.hotels
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = hotels.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can update hotels" ON public.hotels
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = hotels.trip_id
      AND tm.user_id = auth.uid()
    )
  );
CREATE POLICY "Members can delete hotels" ON public.hotels
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.trip_members tm
      WHERE tm.trip_id = hotels.trip_id
      AND tm.user_id = auth.uid()
    )
  );

-- =========================================
-- trip_announcements 行程公告（每行程一条，upsert onConflict trip_id）
-- =========================================
CREATE TABLE public.trip_announcements (
  trip_id    UUID PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  content    TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_announcements TO authenticated;
GRANT ALL ON public.trip_announcements TO service_role;
ALTER TABLE public.trip_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view announcements" ON public.trip_announcements
  FOR SELECT USING (public.is_trip_member(trip_id, auth.uid()));
CREATE POLICY "Members can create announcements" ON public.trip_announcements
  FOR INSERT TO authenticated
  WITH CHECK (public.is_trip_member(trip_id, auth.uid()));
CREATE POLICY "Members can update announcements" ON public.trip_announcements
  FOR UPDATE TO authenticated
  USING (public.is_trip_member(trip_id, auth.uid()));

-- =========================================
-- user_push_subscriptions Web Push 订阅（设备级推送 Token）
-- UNIQUE(user_id, endpoint) 支持客户端幂等 upsert
-- =========================================
CREATE TABLE public.user_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, endpoint)
);
CREATE INDEX idx_user_push_subscriptions_trip
  ON public.user_push_subscriptions(trip_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_push_subscriptions TO authenticated;
GRANT ALL ON public.user_push_subscriptions TO service_role;
ALTER TABLE public.user_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own push subscriptions" ON public.user_push_subscriptions
  FOR ALL USING (auth.uid() = user_id);

-- =========================================
-- 函数：邀请码生成
-- =========================================
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
  attempt INTEGER := 0;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..8 LOOP
      result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.trips WHERE invite_code = result);
    attempt := attempt + 1;
    IF attempt > 20 THEN
      RAISE EXCEPTION 'Could not generate unique invite code';
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- =========================================
-- 触发器：注册时自动创建 profile（含异常容错，不阻断注册事务）
-- =========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name',
             NEW.raw_user_meta_data->>'full_name',
             split_part(NEW.email, '@', 1),
             'Traveler'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 容错：即使 Profile 创建失败也不中断 Auth 注册事务
  -- 后续可通过 service_role 补建 profile 记录
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================
-- 触发器：建行程时自动生成邀请码 + 创建者自动入团
-- =========================================
CREATE OR REPLACE FUNCTION public.handle_new_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.invite_code IS NULL OR NEW.invite_code = '' THEN
    NEW.invite_code := public.generate_invite_code();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER before_insert_trip
  BEFORE INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_trip();

CREATE OR REPLACE FUNCTION public.add_creator_as_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.trip_members (trip_id, user_id)
  VALUES (NEW.id, NEW.created_by)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER after_insert_trip
  AFTER INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.add_creator_as_member();

-- =========================================
-- 函数：通过邀请码加入行程
-- （显式 AS 别名对齐 RETURNS TABLE 输出列，杜绝歧义错误）
-- =========================================
CREATE OR REPLACE FUNCTION public.join_trip_by_code(_code text)
RETURNS TABLE(trip_id uuid, trip_name text, already_member boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _trip record;
  _existing uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT t.id, t.name INTO _trip
  FROM public.trips t
  WHERE t.invite_code = upper(trim(_code))
  LIMIT 1;

  IF _trip.id IS NULL THEN
    RAISE EXCEPTION 'Invite code not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT tm.user_id INTO _existing
  FROM public.trip_members tm
  WHERE tm.trip_id = _trip.id AND tm.user_id = _uid;

  IF _existing IS NULL THEN
    INSERT INTO public.trip_members (trip_id, user_id) VALUES (_trip.id, _uid);
    RETURN QUERY SELECT _trip.id AS trip_id, _trip.name AS trip_name, false AS already_member;
  ELSE
    RETURN QUERY SELECT _trip.id AS trip_id, _trip.name AS trip_name, true AS already_member;
  END IF;
END;
$$;

-- =========================================
-- 函数权限收紧（触发器函数不对外暴露；is_trip_member / join_trip_by_code 开放给 authenticated）
-- =========================================
REVOKE ALL ON FUNCTION public.is_trip_member(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trip_member(UUID, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.generate_invite_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_trip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_trip_by_code(text) TO authenticated;

-- =========================================
-- Storage：私密与公开资产彻底分离
-- 【私密桶 Private】禁止公网匿名访问，客户端经 RLS 鉴权 download → IndexedDB
-- 本地缓存渲染（src/lib/image-cache.ts），严禁交给 wsrv.nl 等第三方 CDN：
--   checkin-images：打卡/票据/餐厅/酒店图片，路径 {trip_id}/{user_id}/xxx.jpg
--   avatars：用户头像，路径 {user_id}/avatar.jpg
-- 【公开桶 Public】无隐私公共旅行参考资料，公开直链 + wsrv.nl CDN 0 流量加速：
--   public-images：百科封面/展品/导览图 + 酒店外观照 + 餐厅攻略截图（见下方独立策略段）
-- =========================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('checkin-images', 'checkin-images', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', false)
ON CONFLICT (id) DO NOTHING;

-- checkin-images：仅限同一行程的同团队友查看打卡照与票据。
-- SECURITY DEFINER 封装：绕过 trip_members 表级 RLS 的策略递归
-- （策略查 trip_members、trip_members 的策略又依赖同表时可能死锁/失败）。
-- STABLE + 单次函数调用，替代策略内多个 EXISTS 子查询，性能更优。
CREATE OR REPLACE FUNCTION public.can_read_checkin_object(_name text, _uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- 1. 标准路径鉴权：第一级目录为 trip_id，且访问者为该行程成员
    SELECT 1 FROM public.trip_members
    WHERE user_id = _uid
      AND trip_id::text = (storage.foldername(_name))[1]::text
  ) OR EXISTS (
    -- 2. 打卡表关联反查：通过 user_stamps 校验同行程队员（兼容老照片历史路径）
    SELECT 1 FROM public.user_stamps s
    JOIN public.trip_members m ON m.trip_id = s.trip_id
    WHERE m.user_id = _uid
      AND (s.photo_url LIKE '%' || _name OR _name LIKE '%' || s.photo_url)
  ) OR EXISTS (
    -- 3. 票据表关联反查：同团成员可查看该行程下的票据凭证
    SELECT 1 FROM public.receipts r
    JOIN public.trip_members m ON m.trip_id::text = r.trip_id::text
    WHERE m.user_id = _uid
      AND (
        r.image_url LIKE '%' || _name
        OR r.images::text LIKE '%' || _name || '%'
      )
  ) OR (
    -- 4. 本人兜底：第二段 = 自己（标准三段式）或首段 = 自己（两段式老路径）
    (storage.foldername(_name))[2] = _uid::text
    OR (storage.foldername(_name))[1] = _uid::text
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_checkin_object(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_checkin_object(text, uuid) TO authenticated;

DROP POLICY IF EXISTS "Trip members can view checkin images" ON storage.objects;
DROP POLICY IF EXISTS "checkin_images_select_trip_member" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to read checkin images" ON storage.objects;

CREATE POLICY "Trip co-members can view checkin images"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'checkin-images'
    AND public.can_read_checkin_object(name, auth.uid())
  );

CREATE POLICY "Trip members can upload checkin images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'checkin-images'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_trip_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "Trip members can update own checkin images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'checkin-images'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_trip_member(((storage.foldername(name))[1])::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'checkin-images'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_trip_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "Users can delete own checkin images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'checkin-images'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- avatars：仅本人可写入/更新/删除自己目录下的头像
CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- avatars：私密桶读取鉴权 —— 本人或同行程成员可查看
-- （头像目录首段 = user_id，与 profiles 表"行程队友可见"的可见性对齐）
CREATE POLICY "Trip co-members can view avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.trip_members tm1
        JOIN public.trip_members tm2 ON tm1.trip_id = tm2.trip_id
        WHERE tm1.user_id = auth.uid()
          AND tm2.user_id = ((storage.foldername(name))[1])::uuid
      )
    )
  );

-- =========================================
-- 公开桶：public-images（公共旅行参考资料统一桶）
-- 博物馆百科封面/展品/导览图 + 酒店外观照(hotels.cover_image_url)
-- + 餐厅攻略截图(trip_restaurants.attachments)：均无个人隐私，
-- public=true 走公开直链 + wsrv.nl CDN 代理，边缘缓存命中时 0 Supabase Egress。
-- 路径 {trip_id}/{user_id}/xxx.jpg
-- =========================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('public-images', 'public-images', true)
ON CONFLICT (id) DO NOTHING;

-- 公开资产：任何人都可通过 Storage API 读取（公开直链本身不走 RLS）
CREATE POLICY "Public can view public-images images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'public-images');

-- 写入：行程成员上传至本人子目录（与 checkin-images 同构）
CREATE POLICY "Trip members can upload public-images images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'public-images'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_trip_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "Trip members can update own public-images images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'public-images'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_trip_member(((storage.foldername(name))[1])::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'public-images'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_trip_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY "Users can delete own public-images images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'public-images'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- =========================================
-- Realtime 实时同步
-- REPLICA IDENTITY FULL：变更事件携带完整行数据，
-- 客户端可精确判断 INSERT/UPDATE/DELETE 并使 filter 在 DELETE 事件上生效
-- =========================================
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.user_locations REPLICA IDENTITY FULL;
ALTER TABLE public.checkins REPLICA IDENTITY FULL;
ALTER TABLE public.trip_items REPLICA IDENTITY FULL;
ALTER TABLE public.user_item_checks REPLICA IDENTITY FULL;
ALTER TABLE public.trip_plans REPLICA IDENTITY FULL;
ALTER TABLE public.trip_announcements REPLICA IDENTITY FULL;
ALTER TABLE public.receipts REPLICA IDENTITY FULL;
ALTER TABLE public.trip_restaurants REPLICA IDENTITY FULL;
ALTER TABLE public.encyclopedia_items REPLICA IDENTITY FULL;
ALTER TABLE public.hotels REPLICA IDENTITY FULL;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'messages',
    'user_locations',
    'checkins',
    'trip_items',
    'user_item_checks',
    'trip_plans',
    'trip_announcements',
    'receipts',
    'trip_restaurants',
    'encyclopedia_items',
    'hotels'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
