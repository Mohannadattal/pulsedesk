import { Pipe, PipeTransform } from '@angular/core';

type DateTimeStyle = 'compact' | 'full';

const FORMATTERS: Record<DateTimeStyle, Intl.DateTimeFormat> = {
  compact: new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
  full: new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  }),
};

@Pipe({ name: 'localDateTime' })
export class LocalDateTimePipe implements PipeTransform {
  transform(value: Date | null | undefined, style: DateTimeStyle = 'compact'): string {
    return value ? FORMATTERS[style].format(value) : '—';
  }
}
