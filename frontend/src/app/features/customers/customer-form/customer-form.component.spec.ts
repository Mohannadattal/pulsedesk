import { TestBed } from '@angular/core/testing';

import { CustomerFormComponent } from './customer-form.component';

describe('CustomerFormComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CustomerFormComponent] })
      .overrideComponent(CustomerFormComponent, { set: { template: '' } })
      .compileComponents();
  });

  it('requires names and at least email or phone', () => {
    const component = TestBed.createComponent(CustomerFormComponent).componentInstance;
    expect(component.form.invalid).toBe(true);
    component.form.patchValue({ firstName: 'Thomas', lastName: 'Müller' });
    expect(component.form.hasError('contactRequired')).toBe(true);
    component.form.controls.email.setValue('thomas@example.net');
    expect(component.form.valid).toBe(true);
  });

  it('accepts canonical E.164 and rejects local phone formats', () => {
    const component = TestBed.createComponent(CustomerFormComponent).componentInstance;
    component.form.controls.phone.setValue('01701234567');
    expect(component.form.controls.phone.hasError('pattern')).toBe(true);
    component.form.controls.phone.setValue('+491701234567');
    expect(component.form.controls.phone.valid).toBe(true);
  });

  it('normalizes optional empty values to null on submission', () => {
    const fixture = TestBed.createComponent(CustomerFormComponent);
    const component = fixture.componentInstance;
    const emitted: unknown[] = [];
    component.saved.subscribe((value) => emitted.push(value));
    component.form.setValue({
      firstName: ' Thomas ',
      lastName: ' Müller ',
      dateOfBirth: null,
      email: 'Test@Example.net',
      phone: null,
      street: ' ',
      houseNumber: null,
      postalCode: null,
      city: null,
      country: 'de',
    });
    component['submit']();
    expect(emitted[0]).toMatchObject({
      first_name: 'Thomas',
      last_name: 'Müller',
      email: 'test@example.net',
      phone: null,
      street: null,
      country: 'DE',
    });
  });
});
