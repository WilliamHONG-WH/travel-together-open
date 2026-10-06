/**
 * 酒店（Hotels）数据模型 — 对应 public.hotels 表
 * id, trip_id, user_id, name, city, country, address, latitude, longitude,
 * check_in_date, check_out_date, notes, cover_image_url, created_at, updated_at
 */
export interface Hotel {
  id: string;
  name: string;
  /** 城市标准化 key（自定义城市为原始字符串），DB 字段 hotels.city */
  city: string;
  /** 国家标准化 key，DB 字段 hotels.country */
  country: string;
  address: string;
  /** 纬度（DB 字段 hotels.latitude）— 保存时正向地理编码自动回填 */
  latitude?: number;
  /** 经度（DB 字段 hotels.longitude） */
  longitude?: number;
  /** 入住日期 YYYY-MM-DD（DB 字段 hotels.check_in_date） */
  checkInDate: string;
  /** 退房日期 YYYY-MM-DD（DB 字段 hotels.check_out_date） */
  checkOutDate: string;
  /** 备注：房型、预订号、早餐说明等（DB 字段 hotels.notes） */
  notes: string;
  /** 封面图 Storage 路径/URL（DB 字段 hotels.cover_image_url） */
  cover: string;
  createdAt?: string;
}

/** Supabase hotels 行 → Hotel 对象映射 */
export function mapRowToHotel(row: any): Hotel {
  return {
    id: row.id,
    name: row.name || "",
    city: row.city || "",
    country: row.country || "",
    address: row.address || "",
    latitude: row.latitude != null && isFinite(Number(row.latitude)) ? Number(row.latitude) : undefined,
    longitude: row.longitude != null && isFinite(Number(row.longitude)) ? Number(row.longitude) : undefined,
    checkInDate: row.check_in_date || "",
    checkOutDate: row.check_out_date || "",
    notes: row.notes || "",
    cover: row.cover_image_url || "",
    createdAt: row.created_at || "",
  };
}

/**
 * 入住周期格式化：例如 2026.09.17 - 09.20
 * - 同年退房日期省略年份；跨年保留完整日期
 * - 仅一端有值时单端展示
 */
export function formatStayDates(
  checkIn?: string | null,
  checkOut?: string | null,
): string {
  const fmt = (d: string) => d.replace(/-/g, ".");
  const ci = (checkIn || "").trim();
  const co = (checkOut || "").trim();
  if (!ci && !co) return "";
  if (!co) return fmt(ci);
  if (!ci) return fmt(co);
  const sameYear = ci.slice(0, 4) === co.slice(0, 4);
  return sameYear ? `${fmt(ci)} - ${co.slice(5).replace(/-/g, ".")}` : `${fmt(ci)} - ${fmt(co)}`;
}

/** 酒店表统一查询字段列表 */
export const HOTEL_SELECT =
  "id, name, city, country, address, latitude, longitude, check_in_date, check_out_date, notes, cover_image_url, created_at";
