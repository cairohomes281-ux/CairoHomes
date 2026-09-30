class BaseChannelProvider {
  /**
   * @param {{
   *   key: string,
   *   label: string,
   *   connectionType: 'ical' | 'api',
   *   capabilities: string[],
   *   configured?: boolean,
   * }} def
   */
  constructor(def) {
    this.key = def.key;
    this.label = def.label;
    this.connectionType = def.connectionType;
    this.capabilities = def.capabilities || [];
    this.configured = def.configured !== false;
  }

  supports(capability) {
    return this.capabilities.includes(capability);
  }

  describe() {
    return {
      key: this.key,
      label: this.label,
      connection_type: this.connectionType,
      capabilities: [...this.capabilities],
      configured: this.configured,
    };
  }

  async authenticate(_connection) {
    throw new Error(`${this.key}: authenticate not implemented`);
  }

  async pullAvailability(_connection, _opts) {
    throw new Error(`${this.key}: availability pull not implemented`);
  }

  async pushAvailability(_connection, _opts) {
    throw new Error(`${this.key}: availability push not implemented`);
  }

  async pullRates(_connection, _opts) {
    throw new Error(`${this.key}: rates pull not implemented`);
  }

  async pushRates(_connection, _opts) {
    throw new Error(`${this.key}: rates push not implemented`);
  }

  async pullReservations(_connection, _opts) {
    throw new Error(`${this.key}: reservations pull not implemented`);
  }

  async pullCancellations(_connection, _opts) {
    throw new Error(`${this.key}: cancellations pull not implemented`);
  }

  async pullModifications(_connection, _opts) {
    throw new Error(`${this.key}: modifications pull not implemented`);
  }

  async pullMessages(_connection, _opts) {
    throw new Error(`${this.key}: messages pull not implemented`);
  }

  async sendMessage(_connection, _opts) {
    throw new Error(`${this.key}: messages send not implemented`);
  }
}

module.exports = { BaseChannelProvider };
