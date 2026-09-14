import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

export type PageMessageKind = 'empty' | 'error' | 'forbidden' | 'not-found';

@Component({
  selector: 'app-page-message',
  imports: [MatButtonModule],
  templateUrl: './page-message.component.html',
  styleUrl: './page-message.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageMessageComponent {
  readonly title = input.required<string>();
  readonly detail = input<string>();
  readonly actionLabel = input<string>();
  readonly kind = input<PageMessageKind>('empty');
  readonly action = output<void>();
}
