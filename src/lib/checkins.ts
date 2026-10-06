// 该文件保留为旧 API 入口。
// 实际数据源已统一到 user_stamps（见 lib/user-stamps.ts）。
// 重新导出以保持所有现有导入（map / detail-sheet 等）的兼容性。

export {
  type Checkin,
  userStampsQueryOptions as checkinsQueryOptions,
} from "./user-stamps";
