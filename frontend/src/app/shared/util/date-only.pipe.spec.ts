import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DateOnlyPipe } from './date-only.pipe';

@Component({
  imports: [DateOnlyPipe],
  template: `<span>{{ dateOfBirth | dateOnly }}</span>`,
})
class DateOnlyHostComponent {
  readonly dateOfBirth = '1987-04-12';
}

describe('DateOnlyPipe', () => {
  it('preserves the API calendar day when rendering a Customer date of birth', () => {
    TestBed.configureTestingModule({ imports: [DateOnlyHostComponent] });
    const fixture = TestBed.createComponent(DateOnlyHostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toBe('Apr 12, 1987');
  });
});
