import { IsNotEmpty, IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class WhatsAppMessageMedia {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  mime_type?: string;

  @IsOptional()
  @IsString()
  sha256?: string;
}

class WhatsAppMessage {
  @IsString()
  from: string;

  @IsString()
  id: string;

  @IsString()
  timestamp: string;

  @IsString()
  type: string;

  @IsOptional()
  text?: { body: string };

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppMessageMedia)
  image?: WhatsAppMessageMedia;

  @IsOptional()
  @IsString()
  caption?: string;
}

class WhatsAppContact {
  @IsString()
  wa_id: string;

  @IsOptional()
  profile?: { name: string };
}

class WhatsAppValue {
  @IsString()
  messaging_product: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WhatsAppMessage)
  messages?: WhatsAppMessage[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WhatsAppContact)
  contacts?: WhatsAppContact[];
}

class WhatsAppChange {
  @IsString()
  field: string;

  @ValidateNested()
  @Type(() => WhatsAppValue)
  value: WhatsAppValue;
}

class WhatsAppEntry {
  @IsString()
  id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WhatsAppChange)
  changes: WhatsAppChange[];
}

export class WhatsAppWebhookDto {
  @IsString()
  object: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WhatsAppEntry)
  entry: WhatsAppEntry[];
}
