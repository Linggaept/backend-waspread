import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConnectPairingDto {
  @ApiProperty({
    example: '628123456789',
    description: 'Phone number to pair with (include country code, no + prefix)',
  })
  @IsString()
  @Matches(/^\d{10,15}$/, { message: 'Phone number must be 10-15 digits' })
  phoneNumber: string;
}
