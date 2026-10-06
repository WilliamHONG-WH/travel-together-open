import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, MapPin, X, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/compress-image";
import { checkinsQueryOptions } from "@/lib/checkins";
import { USER_STAMPS_KEY } from "@/lib/user-stamps";
import { reverseGeocode } from "@/lib/geocode";
import {
  CHECKIN_CATEGORIES,
  DEFAULT_CATEGORY,
  type CheckinCategory,
} from "@/lib/checkin-categories";
import { useT, useI18n } from "@/i18n";

type Coords = { lat: number; lng: number };

export function CheckinDialog({
  open,
  onOpenChange,
  tripId,
  coords,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tripId: string;
  coords: Coords | null;
}) {
  const queryClient = useQueryClient();
  const t = useT();
  const { locale } = useI18n();
  const isEn = locale === "en";
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<CheckinCategory>(DEFAULT_CATEGORY);
  const [compressing, setCompressing] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [resolvedCity, setResolvedCity] = useState<string>("");
  const [geocoding, setGeocoding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset on open change
  useEffect(() => {
    if (!open) {
      setTitle("");
      setNote("");
      setCategory(DEFAULT_CATEGORY);
      setBlob(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setCompressing(false);
      setResolvedCity("");
      setGeocoding(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto reverse geocode when coords change
  useEffect(() => {
    if (!open || !coords) return;
    let cancelled = false;
    setGeocoding(true);
    setResolvedCity("");
    reverseGeocode(coords.lat, coords.lng, isEn ? "en" : "zh")
      .then((city) => {
        if (!cancelled) setResolvedCity(city);
      })
      .finally(() => {
        if (!cancelled) setGeocoding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, coords, isEn]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setCompressing(true);
    try {
      const compressed = await compressImage(file);
      setBlob(compressed);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(compressed));
    } catch (e) {
      console.error(e);
      // 区分 OOM 降级场景：IMAGE_TOO_LARGE 提示用户截屏后重试，其他错误提示通用失败
      const msg = e instanceof Error && e.message === "IMAGE_TOO_LARGE"
        ? t("checkin.imageTooLarge")
        : t("checkin.imageFailed");
      toast.error(msg);
    } finally {
      setCompressing(false);
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!coords) throw new Error(t("checkin.missingCoords"));
      if (!title.trim()) throw new Error(t("checkin.titleRequired"));
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error(t("checkin.notLoggedIn"));

      let imagePath: string | null = null;
      if (blob) {
        const path = `${tripId}/${user.id}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("checkin-images")
          .upload(path, blob, {
            contentType: "image/jpeg",
            cacheControl: "3600000",
            upsert: false,
          });
        if (upErr) throw upErr;
        imagePath = path;
      }

      const insertPayload = {
        trip_id: tripId,
        user_id: user.id,
        title: title.trim(),
        note: note.trim() || null,
        image_url: imagePath,
        lat: coords.lat,
        lng: coords.lng,
        category,
        city: resolvedCity || null,
      };
      const { data, error } = await (supabase
        .from("checkins")
        .insert(insertPayload as any) as any)
        .select("id, trip_id, user_id, title, note, image_url, lat, lng, created_at, category, city")
        .single();
      if (error) throw error;

      // 同步写入 user_stamps 表（足迹册数据源）
      // 非阻塞：即使失败也不影响 checkin 主流程，仅提示用户
      try {
        const stampPayload = {
          trip_id: tripId,
          created_by: user.id,
          title: title.trim(),
          city: resolvedCity || null,
          photo_url: imagePath,
          notes: note.trim() || null,
          category,
          latitude: coords.lat,
          longitude: coords.lng,
        };
        const { error: stampErr } = await (supabase as any)
          .from("user_stamps")
          .insert(stampPayload);
        if (stampErr) {
          console.error("[CheckinDialog] user_stamps 写入失败:", stampErr);
          toast.warning(
            isEn
              ? "Check-in saved, but stamp sync failed."
              : "打卡已保存，但足迹同步失败。"
          );
        }
      } catch (stampEx) {
        console.error("[CheckinDialog] user_stamps 写入异常:", stampEx);
        toast.warning(
          isEn
            ? "Check-in saved, but stamp sync failed."
            : "打卡已保存，但足迹同步失败。"
        );
      }

      return data;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(checkinsQueryOptions(tripId).queryKey, (old) => {
        const list = (old as any[] | undefined) ?? [];
        return [row, ...list];
      });
      queryClient.invalidateQueries({ queryKey: ["checkins", tripId] });
      // 刷新足迹册缓存，确保打卡后立即出现在足迹册
      queryClient.invalidateQueries({ queryKey: USER_STAMPS_KEY(tripId) });
      toast.success(t("checkin.success"));
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast.error(e?.message ?? t("checkin.failed"));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border/60 bg-card">
        <DialogHeader>
          <DialogTitle>{t("checkin.newCheckin")}</DialogTitle>
          <DialogDescription className="flex flex-col gap-1 text-xs">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {coords
                ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
                : t("checkin.waitingLocation")}
            </span>
            {coords && (
              <span className="flex items-center gap-1 font-semibold text-primary">
                {geocoding ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {isEn ? "Detecting city..." : "正在识别城市..."}
                  </>
                ) : (
                  <>
                    <Building2 className="h-3 w-3" />
                    {resolvedCity || (isEn ? "Unknown" : "未知区域")}
                  </>
                )}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder={t("checkin.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
          />

          {/* Category selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              {t("select_category")}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(CHECKIN_CATEGORIES).map(([key, config]) => {
                const IconComponent = config.icon;
                const isSelected = category === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCategory(key as CheckinCategory)}
                    className={`flex flex-col items-center justify-center rounded-xl border p-2 transition-all duration-200 ${
                      isSelected
                        ? `${config.color} scale-105 ring-1 ring-current ring-offset-1 ring-offset-background`
                        : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <IconComponent className="mb-1 h-5 w-5" />
                    <span className="text-[11px]">{t(config.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Textarea
            placeholder={t("checkin.notePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
          />

          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            {previewUrl ? (
              <div className="relative overflow-hidden rounded-xl border border-border/60">
                <img src={previewUrl} alt={t("checkin.preview")} className="h-40 w-full object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    setBlob(null);
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground backdrop-blur"
                  aria-label={t("checkin.removeImage")}
                >
                  <X className="h-4 w-4" />
                </button>
                {blob && (
                  <div className="absolute bottom-2 left-2 rounded-md bg-background/70 px-2 py-0.5 text-xs backdrop-blur">
                    {(blob.size / 1024).toFixed(0)} KB
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={compressing}
                className="flex h-24 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-muted/30 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
              >
                {compressing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {t("checkin.compressing")}
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4" /> {t("checkin.takePhoto")}
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || compressing || !coords || !title.trim()}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("common.submitting")}
              </>
            ) : (
              t("checkin.checkin")
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
