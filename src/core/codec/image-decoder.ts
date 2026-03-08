/*
 * Author: Ali Parnan
 */

import { decode_rgb, type DrawPacket } from "./rgb-helpers";

export class XpraImageDecoder {
  async convertToBitmap(packet: DrawPacket): Promise<DrawPacket> {
    const width = packet[4];
    const height = packet[5];
    const coding = packet[6];

    if (coding.startsWith("rgb")) {
      const data = decode_rgb(packet);
      const imageData = new ImageData(
        new Uint8ClampedArray(data.buffer as ArrayBuffer),
        width,
        height,
      );
      const bitmap = await createImageBitmap(
        imageData,
        0,
        0,
        width,
        height,
      );
      packet[6] = `bitmap:${coding}`;
      packet[7] = bitmap;
    } else {
      const paintCoding = coding.split("/")[0];
      const options = packet[10] as Record<string, unknown>;
      const bitmapOptions: ImageBitmapOptions = {
        premultiplyAlpha: "none",
      };

      if ("scaled_size" in options) {
        bitmapOptions.resizeWidth = width;
        bitmapOptions.resizeHeight = height;
        bitmapOptions.resizeQuality =
          (options["scaling-quality"] as ResizeQuality) || "medium";
      }

      const blob = new Blob(
        [(packet[7] as Uint8Array).buffer as ArrayBuffer],
        { type: `image/${paintCoding}` },
      );
      const bitmap = await createImageBitmap(blob, bitmapOptions);
      packet[6] = `bitmap:${coding}`;
      packet[7] = bitmap;
    }
    return packet;
  }
}
