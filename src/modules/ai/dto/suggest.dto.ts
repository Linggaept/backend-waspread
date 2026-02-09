import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SuggestRequestDto {
  @ApiProperty({
    description: 'Phone number of the chat partner',
    example: '628123456789',
  })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({
    description: 'The incoming message to generate suggestions for',
    example: 'Kak, harga paket premium berapa ya?',
  })
  @IsString()
  @IsNotEmpty()
  message: string;
}
