import { supabase } from "@/integrations/supabase/client";
import { uploadImageToStorage } from "@/lib/compress-image";
import { geocodeVenue } from "@/lib/geocode";
import { normalizeRestaurant, type Restaurant } from "./types";

// Cast supabase to any for tables not yet in generated types
const db = supabase as any;

/**
 * 餐厅落库统一链路（规划模块 / 地图模块共用）：
 * 1. 新截图逐张上传 Storage（RLS：路径第二段 = auth.uid()）
 * 2. 地址自动正向地理编码 —— 名称/地址/城市/国家变化或坐标缺失时，
 *    按【地址 + 城市 + 国家 + 名称】调用 geocodeVenue 自动反算经纬度，
 *    无需用户手动输入；三级均未命中时保留 null（绝不用城市中心充数）
 * 3. insert（新建）/ update（编辑）并返回归一化后的 Restaurant
 */
export async function persistRestaurant(opts: {
  tripId: string;
  form: Restaurant;
  newFiles: File[];
  /** 编辑前的旧数据（用于判断地址是否变化触发重编码）；null = 新建 */
  prev: Restaurant | null;
}): Promise<Restaurant> {
  const { tripId, form, newFiles, prev } = opts;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not signed in / 未登录");

  // 1. 新增截图逐张上传至公开桶 public-images：攻略截图属公共旅行参考资料
  //    （无隐私），数据库存完整公开直链（渲染端自动走 wsrv.nl CDN，0 Egress）。
  //    旧数据（checkin-images 相对路径）渲染时自动回落私密缓存链路，无需迁移。
  const newPaths: string[] = [];
  for (const file of newFiles) {
    const p = await uploadImageToStorage(file, `${tripId}/${userId}`, "public-images");
    newPaths.push(
      supabase.storage.from("public-images").getPublicUrl(p).data.publicUrl,
    );
  }
  const attachments = [...form.attachments, ...newPaths];

  // 2. 地址自动地理编码：关键字段变化或坐标缺失时重算
  const geoChanged =
    !!prev &&
    (prev.address !== form.address ||
      prev.city !== form.city ||
      prev.country !== form.country ||
      prev.name !== form.name);
  let geo: { lat: number; lng: number } | null = null;
  if (geoChanged || form.latitude == null || form.longitude == null) {
    geo = await geocodeVenue({
      name: form.name,
      address: form.address,
      cityKey: form.city,
      countryKey: form.country,
    });
  }

  const payload = {
    trip_id: tripId,
    name: form.name,
    city: form.city || null,
    country: form.country || null,
    meal_type: form.meal_type,
    address: form.address || null,
    hours: form.hours || null,
    notes: form.notes || null,
    dishes: form.dishes,
    attachments,
    latitude: geo ? geo.lat : form.latitude ?? null,
    longitude: geo ? geo.lng : form.longitude ?? null,
  };

  if (!prev) {
    const { data, error } = await db.from("trip_restaurants").insert(payload).select("*").single();
    if (error) throw error;
    return normalizeRestaurant(data);
  }
  const { data, error } = await db
    .from("trip_restaurants")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", form.id)
    .select("*")
    .single();
  if (error) throw error;
  return normalizeRestaurant(data);
}
