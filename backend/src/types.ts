import { z } from "zod";

export const CreateOrderSchema = z.object({
  marketId: z.string(),
  side: z.enum(["yes", "no"]),
  type: z.enum(["buy", "sell"]),
  price: z.number().int(), // 10 => 0.10$
  qty: z.number().int(), // 10 => 10qty
});

export type Orderbook = {
  [key: string]: {
    availableQty: number;
    orders: {
      userId: string;
      qty: number;
      filledQty: number;
      originalOrderId: string;
      reverseOrder: boolean;
    }[];
  };
};

export const SplitSchema = z.object({
  marketId: z.string(),
  amount: z.number(),
});

export const OnrampSchema = z.object({
  amount: z.number(),
});

export const OfframpSchema = z.object({
  amount: z.number(),
});

export const CreateMarketSchema = z.object({
  title: z.string(),
  description: z.string(),
  resolutionDescription: z.string(),
});

export const ResolveSchema = z.object({
  resolution: z.enum(["Yes", "No"]),
});
