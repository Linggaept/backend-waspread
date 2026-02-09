import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../dto/api-response.dto';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        // Skip transformation for raw responses (e.g., file downloads)
        const response = context.switchToHttp().getResponse();
        const contentType = response.getHeader('content-type');

        if (
          contentType &&
          typeof contentType === 'string' &&
          contentType.includes('text/csv')
        ) {
          return data;
        }

        // Already wrapped
        if (data instanceof ApiResponse) {
          return data;
        }

        return ApiResponse.success(data);
      }),
    );
  }
}
