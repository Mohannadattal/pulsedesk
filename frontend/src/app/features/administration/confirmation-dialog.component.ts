import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface ConfirmationDialogData {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
}

@Component({
  selector: 'app-confirmation-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content
      ><p>{{ data.message }}</p></mat-dialog-content
    >
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="dialogRef.close(false)">Cancel</button>
      <button mat-flat-button type="button" color="warn" [mat-dialog-close]="true" cdkFocusInitial>
        {{ data.confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmationDialogComponent {
  protected readonly data = inject<ConfirmationDialogData>(MAT_DIALOG_DATA);
  protected readonly dialogRef = inject(MatDialogRef<ConfirmationDialogComponent>);
}
