import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'

import type { NotificationPriority } from './types'

const PRIORITIES: NotificationPriority[] = ['critical', 'warning', 'info']

export class PriorityRuleDto {
  @IsString()
  condition!: string

  @IsIn(PRIORITIES)
  priority!: NotificationPriority

  @IsOptional()
  @IsBoolean()
  shouldNotify?: boolean
}

export class UnderfundedConfigDto {
  @IsNumber()
  min_deficit_sol!: number

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriorityRuleDto)
  priority_rules!: PriorityRuleDto[]

  @IsNumber()
  significant_change_pct!: number

  @IsNumber()
  renotify_interval_hours!: number

  @IsNumber()
  relevance_hours!: number
}

export class SimpleEventConfigDto {
  @IsIn(PRIORITIES)
  priority!: NotificationPriority

  @IsNumber()
  renotify_interval_hours!: number

  @IsNumber()
  relevance_hours!: number
}

export class CapChangedConfigDto {
  @IsArray()
  @IsString({ each: true })
  notify_cap_types!: string[]

  @IsIn(PRIORITIES)
  notify_cap_types_priority!: NotificationPriority

  @IsIn(PRIORITIES)
  other_caps_priority!: NotificationPriority

  @IsBoolean()
  other_caps_shouldNotify!: boolean

  @IsNumber()
  renotify_interval_hours!: number

  @IsNumber()
  relevance_hours!: number
}

export class AnnouncementConfigDto {
  @IsIn(PRIORITIES)
  priority!: NotificationPriority

  @IsBoolean()
  skip_dedup!: boolean

  @IsNumber()
  relevance_hours!: number
}

export class PassthroughEventConfigDto {
  @IsIn(PRIORITIES)
  priority!: NotificationPriority

  @IsNumber()
  relevance_hours!: number

  @IsOptional()
  @IsBoolean()
  skip_dedup?: boolean
}

export class EvaluatedEventsDto {
  @ValidateNested()
  @Type(() => UnderfundedConfigDto)
  bond_underfunded_change!: UnderfundedConfigDto

  @ValidateNested()
  @Type(() => SimpleEventConfigDto)
  auction_exited!: SimpleEventConfigDto

  @ValidateNested()
  @Type(() => CapChangedConfigDto)
  cap_changed!: CapChangedConfigDto

  @ValidateNested()
  @Type(() => SimpleEventConfigDto)
  bond_removed!: SimpleEventConfigDto

  @ValidateNested()
  @Type(() => AnnouncementConfigDto)
  announcement!: AnnouncementConfigDto
}

export class ThresholdConfigDto {
  @ValidateNested()
  @Type(() => EvaluatedEventsDto)
  evaluated_events!: EvaluatedEventsDto

  @IsDefined()
  passthrough_events!: Record<string, PassthroughEventConfigDto>
}
