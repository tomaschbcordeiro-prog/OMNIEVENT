import { BedDouble, Briefcase, Bus, CarFront, Landmark, NotebookPen, Plane, Sparkles, TrainFront, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { PlanKind } from "@/lib/trip-plans";

/** The icon of each kind of plan. */
export const KIND_ICON: Record<PlanKind, LucideIcon> = {
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  car: CarFront,
  stay: BedDouble,
  meeting: Briefcase,
  meal: UtensilsCrossed,
  visit: Landmark,
  activity: Sparkles,
  note: NotebookPen,
};
